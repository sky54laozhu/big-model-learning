import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILY } from "../common/styles";

export const Subtitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });

  return (
    <div style={{
      position: "absolute",
      bottom: 100,
      left: 40, right: 40,
      textAlign: "center",
      fontFamily: FONT_FAMILY,
      fontSize: 34,
      fontWeight: 600,
      color: "#ffffff",
      textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
      lineHeight: 1.6,
      opacity: entrance,
      transform: `translateY(${(1 - entrance) * 12}px)`,
      padding: "14px 24px",
      borderRadius: 12,
      background: "rgba(0,0,0,0.5)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      backdropFilter: "blur(4px)",
    }}>
      {text}
    </div>
  );
};
