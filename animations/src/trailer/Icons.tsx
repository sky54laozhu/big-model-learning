import React from "react";

const S: React.CSSProperties = { width: "100%", height: "100%" };

export const IconBrain: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <path d="M24 4C18 4 14 8 14 13c0 2 .5 3.5 1.5 5C12 19.5 10 23 10 27c0 5.5 4 10 9 11v2h10v-2c5-1 9-5.5 9-11 0-4-2-7.5-5.5-9 1-1.5 1.5-3 1.5-5 0-5-4-9-10-9z" fill="#60a5fa" opacity="0.2"/>
    <path d="M24 6c-4.5 0-8 3.5-8 8 0 2 .7 3.8 2 5.2l.5.6-.7.4C14.5 22 12 25.2 12 29c0 4.8 3.5 8.8 8 9.8l1 .2v2h6v-2l1-.2c4.5-1 8-5 8-9.8 0-3.8-2.5-7-5.8-8.8l-.7-.4.5-.6c1.3-1.4 2-3.2 2-5.2 0-4.5-3.5-8-8-8z" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M24 14v24M20 18h8M18 26h12M20 30h8" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
  </svg>
);

export const IconGear: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <path d="M24 16a8 8 0 100 16 8 8 0 000-16z" fill="#f59e0b" opacity="0.2"/>
    <path d="M20.4 6.4l-1.2 4.4a12 12 0 00-3.8 2.2L11.2 11l-3.6 6.2 3.8 2.6a12 12 0 000 4.4l-3.8 2.6 3.6 6.2 4.2-2a12 12 0 003.8 2.2l1.2 4.4h7.2l1.2-4.4a12 12 0 003.8-2.2l4.2 2 3.6-6.2-3.8-2.6a12 12 0 000-4.4l3.8-2.6-3.6-6.2-4.2 2a12 12 0 00-3.8-2.2L27.6 6.4z" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="24" cy="24" r="7" stroke="#f59e0b" strokeWidth="2"/>
  </svg>
);

export const IconRocket: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <path d="M24 4c-6 8-8 16-8 24h16c0-8-2-16-8-24z" fill="#22c55e" opacity="0.2"/>
    <path d="M24 4c-6 8-8 16-8 24h16c0-8-2-16-8-24z" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 28c-4 0-6 4-7 8l7-2" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M32 28c4 0 6 4 7 8l-7-2" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="24" cy="20" r="3" stroke="#22c55e" strokeWidth="2"/>
    <path d="M20 34h8v6l-4 4-4-4z" fill="#22c55e" opacity="0.3" stroke="#22c55e" strokeWidth="1.5"/>
  </svg>
);

export const IconBulb: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <path d="M24 6a14 14 0 00-8 25.4V36a4 4 0 008 0v-4.6A14 14 0 0024 6z" fill="#a855f7" opacity="0.15"/>
    <path d="M24 6a14 14 0 00-8 25.4V36a4 4 0 008 0v-4.6A14 14 0 0024 6z" stroke="#a855f7" strokeWidth="2"/>
    <path d="M20 36h8M20 40h8" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
    <path d="M24 14v4M30 18l-3 3M18 18l3 3" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <circle cx="24" cy="22" r="5" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.5"/>
  </svg>
);

export const IconArch: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <rect x="8" y="8" width="32" height="32" rx="4" fill="#ef4444" opacity="0.12"/>
    <rect x="8" y="8" width="32" height="32" rx="4" stroke="#ef4444" strokeWidth="2"/>
    <rect x="14" y="14" width="8" height="8" rx="2" stroke="#ef4444" strokeWidth="1.5"/>
    <rect x="26" y="14" width="8" height="8" rx="2" stroke="#ef4444" strokeWidth="1.5"/>
    <rect x="14" y="26" width="8" height="8" rx="2" stroke="#ef4444" strokeWidth="1.5"/>
    <rect x="26" y="26" width="8" height="8" rx="2" stroke="#ef4444" strokeWidth="1.5"/>
    <path d="M22 18h4M18 22v4M30 22v4M22 30h4" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export const IconRobot: React.FC = () => (
  <svg viewBox="0 0 48 48" fill="none" style={S}>
    <rect x="10" y="14" width="28" height="24" rx="6" fill="#a855f7" opacity="0.15"/>
    <rect x="10" y="14" width="28" height="24" rx="6" stroke="#a855f7" strokeWidth="2"/>
    <circle cx="24" cy="10" r="3" stroke="#a855f7" strokeWidth="2"/>
    <line x1="24" y1="13" x2="24" y2="14" stroke="#a855f7" strokeWidth="2"/>
    <circle cx="19" cy="24" r="3" fill="#a855f7" opacity="0.6"/>
    <circle cx="29" cy="24" r="3" fill="#a855f7" opacity="0.6"/>
    <path d="M19 31h10" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
    <line x1="6" y1="22" x2="10" y2="22" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
    <line x1="38" y1="22" x2="42" y2="22" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
    <line x1="6" y1="28" x2="10" y2="28" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
    <line x1="38" y1="28" x2="42" y2="28" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export const PHASE_ICON_MAP: Record<number, React.FC> = {
  1: IconBrain,
  2: IconGear,
  3: IconRocket,
  4: IconBulb,
  5: IconArch,
};
