export const COLORS = {
  bg: "#ffffff",
  text: "#1a1a1a",
  textSecondary: "#6b7280",
  red: "#dc2626",
  orange: "#d97706",
  green: "#16a34a",
  blue: "#2563eb",
  purple: "#7c3aed",
  lightRed: "#fef2f2",
  lightOrange: "#fefce8",
  lightGreen: "#f0fdf4",
  lightBlue: "#eff6ff",
  border: "#e2e8f0",
  mountainFill: "#e8f5ec",
  mountainStroke: "#2e7d3a",
};

export const FONT_FAMILY =
  "-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif";

export const baseStyle: React.CSSProperties = {
  backgroundColor: COLORS.bg,
  fontFamily: FONT_FAMILY,
  color: COLORS.text,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};
