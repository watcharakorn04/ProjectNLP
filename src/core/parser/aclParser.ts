import { AccessList, AclRule, AclType, ConfigSection } from './types';
import { formatAclAddress, isIPv4, stripUndefined } from './utils';

type Read<T> = { value: T; next: number } | undefined;

/** Port match after an address: `eq 22`, `lt 1024`, `range 1000 2000`. */
function readPort(tokens: string[], i: number): Read<string> {
  const op = tokens[i]?.toLowerCase();
  if ((op === 'eq' || op === 'neq' || op === 'lt' || op === 'gt') && tokens[i + 1]) {
    return { value: `${op} ${tokens[i + 1]}`, next: i + 2 };
  }
  if (op === 'range' && tokens[i + 2]) return { value: `range ${tokens[i + 1]} ${tokens[i + 2]}`, next: i + 3 };
  return undefined;
}

/** Adds rules to the list with that name, creating it on first sight so numbered and named syntax can share one ACL. */
function getAcl(acls: Map<string, AccessList>, name: string, type: AclType): AccessList {
  let acl = acls.get(name);
  if (!acl) {
    acl = { name, type, rules: [] };
    acls.set(name, acl);
  }
  return acl;
}

// ---------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------

function ciscoNumberedType(value: string): AclType | undefined {
  const n = Number(value);
  if ((n >= 1 && n <= 99) || (n >= 1300 && n <= 1999)) return 'standard';
  if ((n >= 100 && n <= 199) || (n >= 2000 && n <= 2699)) return 'extended';
  return undefined;
}

/** `any` | `host A` | `A W` | `A` (standard ACLs: implicit host) | `object-group N`. */
function readCiscoAddress(tokens: string[], i: number): Read<string> {
  const token = tokens[i]?.toLowerCase();
  if (token === 'any') return { value: 'any', next: i + 1 };
  if (token === 'host' && isIPv4(tokens[i + 1])) return { value: formatAclAddress(tokens[i + 1]), next: i + 2 };
  if ((token === 'object-group' || token === 'addrgroup') && tokens[i + 1]) {
    return { value: `object-group ${tokens[i + 1]}`, next: i + 2 };
  }
  if (isIPv4(tokens[i])) {
    return isIPv4(tokens[i + 1])
      ? { value: formatAclAddress(tokens[i], tokens[i + 1]), next: i + 2 }
      : { value: formatAclAddress(tokens[i]), next: i + 1 };
  }
  return undefined;
}

/** Parses one ACE: `[seq] permit|deny ...`. Remarks and unsupported entries return null. */
function parseCiscoAce(line: string, type: AclType): AclRule | null {
  const tokens = line.split(/\s+/);
  let i = 0;
  const sequence = /^\d+$/.test(tokens[0]) ? Number(tokens[i++]) : undefined;
  const action = tokens[i++]?.toLowerCase();
  if (action !== 'permit' && action !== 'deny') return null;

  if (type === 'standard') {
    const source = readCiscoAddress(tokens, i);
    if (!source) return null;
    return stripUndefined<AclRule>({ sequence, action, protocol: 'ip', source: source.value, destination: 'any' });
  }

  const protocol = tokens[i++]?.toLowerCase();
  const source = readCiscoAddress(tokens, i);
  if (!protocol || !source) return null;
  const sourcePort = readPort(tokens, source.next);
  const destination = readCiscoAddress(tokens, sourcePort?.next ?? source.next);
  if (!destination) return null;
  const destinationPort = readPort(tokens, destination.next);

  return stripUndefined<AclRule>({
    sequence,
    action,
    protocol,
    source: source.value,
    sourcePort: sourcePort?.value,
    destination: destination.value,
    destinationPort: destinationPort?.value
  });
}

/** Numbered `access-list N ...` lines and named `ip access-list standard|extended NAME` blocks. */
export function parseCiscoAcls(sections: ConfigSection[]): AccessList[] {
  const acls = new Map<string, AccessList>();

  for (const { header, body } of sections) {
    let m: RegExpMatchArray | null;
    if ((m = header.match(/^access-list\s+(\d+)\s+(.+)$/i))) {
      const type = ciscoNumberedType(m[1]);
      const rule = type && parseCiscoAce(m[2], type);
      if (type && rule) getAcl(acls, m[1], type).rules.push(rule);
    } else if ((m = header.match(/^ip access-list\s+(standard|extended)\s+(\S+)/i))) {
      const type = m[1].toLowerCase() as AclType;
      const acl = getAcl(acls, m[2], type);
      for (const cmd of body) {
        const rule = parseCiscoAce(cmd, type);
        if (rule) acl.rules.push(rule);
      }
    }
  }

  return [...acls.values()];
}

// ---------------------------------------------------------------------------
// Huawei VRP
// ---------------------------------------------------------------------------

/** 2000-2999 basic, 3000-3999 advanced. Layer 2 / user ACLs match on other fields and are skipped. */
function huaweiNumberedType(value: string): AclType | undefined {
  const n = Number(value);
  if (n >= 2000 && n <= 2999) return 'standard';
  if (n >= 3000 && n <= 3999) return 'extended';
  return undefined;
}

function huaweiAclHeader(header: string): { name: string; type: AclType } | undefined {
  let m: RegExpMatchArray | null;
  if ((m = header.match(/^acl\s+(?:number\s+)?(\d+)\b/i))) {
    const type = huaweiNumberedType(m[1]);
    return type && { name: m[1], type };
  }
  if ((m = header.match(/^acl\s+name\s+(\S+)(?:\s+(basic|advanced|\d+))?/i))) {
    const kind = m[2]?.toLowerCase();
    // A named ACL without a type is an advanced ACL.
    const type = kind === 'basic' ? 'standard' : kind && /^\d+$/.test(kind) ? huaweiNumberedType(kind) : 'extended';
    return type && { name: m[1], type };
  }
  return undefined;
}

const HUAWEI_PROTOCOL_RE = /^(ip|tcp|udp|icmp|gre|igmp|ospf|ipinip|\d+)$/i;

/** `any` | `A W` | `A 0` (host) after a `source` / `destination` keyword. */
function readHuaweiAddress(tokens: string[], i: number): Read<string> {
  if (tokens[i]?.toLowerCase() === 'any') return { value: 'any', next: i + 1 };
  if (!isIPv4(tokens[i])) return undefined;
  const wildcard = tokens[i + 1];
  return wildcard === '0' || isIPv4(wildcard)
    ? { value: formatAclAddress(tokens[i], wildcard), next: i + 2 }
    : { value: formatAclAddress(tokens[i]), next: i + 1 };
}

/** `rule [id] permit|deny [protocol] [source ...] [source-port ...] [destination ...] [destination-port ...] ...` */
function parseHuaweiRule(cmd: string): AclRule | null {
  const tokens = cmd.split(/\s+/);
  if (tokens[0].toLowerCase() !== 'rule') return null;
  let i = 1;
  const sequence = /^\d+$/.test(tokens[i]) ? Number(tokens[i++]) : undefined;
  const action = tokens[i++]?.toLowerCase();
  if (action !== 'permit' && action !== 'deny') return null;

  const rule: AclRule = { sequence, action, protocol: 'ip', source: 'any', destination: 'any' };
  if (HUAWEI_PROTOCOL_RE.test(tokens[i] ?? '')) rule.protocol = tokens[i++].toLowerCase();

  while (i < tokens.length) {
    const keyword = tokens[i].toLowerCase();
    const read =
      keyword === 'source' || keyword === 'destination'
        ? readHuaweiAddress(tokens, i + 1)
        : keyword === 'source-port' || keyword === 'destination-port'
          ? readPort(tokens, i + 1)
          : undefined;
    if (!read) {
      i++;
      continue;
    }
    if (keyword === 'source') rule.source = read.value;
    else if (keyword === 'destination') rule.destination = read.value;
    else if (keyword === 'source-port') rule.sourcePort = read.value;
    else rule.destinationPort = read.value;
    i = read.next;
  }

  return stripUndefined<AclRule>(rule);
}

/** `acl [number] N` and `acl name NAME [basic|advanced|N]` blocks with their `rule` lines. */
export function parseHuaweiAcls(sections: ConfigSection[]): AccessList[] {
  const acls = new Map<string, AccessList>();

  for (const { header, body } of sections) {
    const acl = huaweiAclHeader(header);
    if (!acl) continue;
    const entry = getAcl(acls, acl.name, acl.type);
    for (const cmd of body) {
      const rule = parseHuaweiRule(cmd);
      if (rule) entry.rules.push(rule);
    }
  }

  return [...acls.values()];
}
