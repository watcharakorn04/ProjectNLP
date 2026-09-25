import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ExtractedNetworkConfig, maskToPrefix } from '../core/parser';

const MAX_LISTED = 3;

interface ParsedConfigSummaryProps {
  config: ExtractedNetworkConfig;
  isDark: boolean;
  isTH: boolean;
}

export const ParsedConfigSummary: React.FC<ParsedConfigSummaryProps> = ({ config, isDark, isTH }) => {
  const { vlans, interfaces, sviGateways, staticRoutes, meta } = config;

  const stats = [
    { label: 'VLANs', value: vlans.length },
    { label: isTH ? 'พอร์ต' : 'Ifaces', value: interfaces.length },
    { label: 'SVIs', value: sviGateways.length },
    { label: isTH ? 'เส้นทาง' : 'Routes', value: staticRoutes.length }
  ];

  const sectionLabel = 'text-[10px] font-semibold uppercase tracking-wide text-slate-500';
  const moreLabel = (count: number) => (isTH ? `+ อีก ${count} รายการ` : `+${count} more`);

  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-800/60 space-y-2.5">
      <div className="grid grid-cols-4 gap-1.5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`flex flex-col items-center py-1.5 rounded-lg border ${
              isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <span className={`text-sm font-bold font-mono leading-none ${isDark ? 'text-cyan-300' : 'text-blue-700'}`}>
              {stat.value}
            </span>
            <span className="text-[9px] text-slate-400 mt-1 leading-none">{stat.label}</span>
          </div>
        ))}
      </div>

      {sviGateways.length > 0 && (
        <div className="space-y-1">
          <p className={sectionLabel}>{isTH ? 'Gateway (SVI)' : 'SVI Gateways'}</p>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {sviGateways.slice(0, MAX_LISTED).map((gw) => (
              <li key={gw.interfaceName} className="flex justify-between gap-2">
                <span className="text-slate-400">VLAN {gw.vlanId}</span>
                <span className={`truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                  {gw.ipAddress}/{maskToPrefix(gw.subnetMask)}
                </span>
              </li>
            ))}
          </ul>
          {sviGateways.length > MAX_LISTED && (
            <p className="text-[10px] text-slate-500">{moreLabel(sviGateways.length - MAX_LISTED)}</p>
          )}
        </div>
      )}

      {staticRoutes.length > 0 && (
        <div className="space-y-1">
          <p className={sectionLabel}>{isTH ? 'Static Route' : 'Static Routes'}</p>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {staticRoutes.slice(0, MAX_LISTED).map((route) => (
              <li key={`${route.vrf ?? ''}|${route.destination}/${route.mask}|${route.nextHop}`} className="flex justify-between gap-2">
                <span className="text-slate-400 truncate">
                  {route.destination}/{maskToPrefix(route.mask)}
                </span>
                <span className={`truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>→ {route.nextHop}</span>
              </li>
            ))}
          </ul>
          {staticRoutes.length > MAX_LISTED && (
            <p className="text-[10px] text-slate-500">{moreLabel(staticRoutes.length - MAX_LISTED)}</p>
          )}
        </div>
      )}

      {meta.warnings.length > 0 && (
        <div
          title={meta.warnings.join('\n')}
          className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-[10px] leading-snug"
        >
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
          <span>{meta.warnings[0]}</span>
        </div>
      )}
    </div>
  );
};
