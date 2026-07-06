import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILY } from "../common/styles";
import { Subtitle } from "./Subtitle";
import { IconRobot } from "./Icons";

export const TitleScene: React.FC<{
  title: string;
  subtitle: string;
  badge?: string;
  narration?: string;
  variant?: "opening" | "closing";
}> = ({ title, subtitle, badge, narration, variant = "opening" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: { damping: 10, stiffness: 120, mass: 0.8 } });
  const subtitleOpacity = interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const badgeScale = spring({ frame: Math.max(0, frame - 30), fps, config: { damping: 12, stiffness: 100 } });

  const isOpening = variant === "opening";
  const accent = isOpening ? "#a855f7" : "#3b82f6";

  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #121830 0%, #0c0f1a 60%)", fontFamily: FONT_FAMILY }}>
      {/* Animated gradient orbs */}
      <div style={{
        position: "absolute",
        width: 500, height: 500, borderRadius: "50%",
        background: `radial-gradient(circle, ${accent}35 0%, transparent 70%)`,
        left: width / 2 - 250 + Math.sin(frame * 0.025) * 120,
        top: height / 2 - 350 + Math.cos(frame * 0.02) * 100,
      }} />
      <div style={{
        position: "absolute",
        width: 400, height: 400, borderRadius: "50%",
        background: "radial-gradient(circle, #3b82f628 0%, transparent 70%)",
        right: -50 + Math.cos(frame * 0.018) * 60,
        bottom: height / 3 + Math.sin(frame * 0.022) * 50,
      }} />

      {/* Content - shifted up to compensate for subtitle */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 50px",
        paddingBottom: 240,
      }}>
        {isOpening && (
          <div style={{
            width: 80, height: 80, marginBottom: 56,
            opacity: titleIn,
            transform: `scale(${titleIn})`,
          }}>
            <IconRobot />
          </div>
        )}

        <div style={{
          fontSize: 60, fontWeight: 800, color: "#ffffff",
          textAlign: "center", lineHeight: 1.5,
          transform: `scale(${interpolate(titleIn, [0, 1], [1.15, 1.0])}) translateY(${(1 - titleIn) * 80}px)`,
          opacity: titleIn,
        }}>
          {title}
        </div>

        <div style={{
          fontSize: 34, fontWeight: 600, color: accent,
          textAlign: "center", marginTop: 40,
          opacity: subtitleOpacity,
          letterSpacing: 1.5,
        }}>
          {subtitle}
        </div>

        {badge && (
          <div style={{
            marginTop: 72,
            padding: "18px 44px",
            borderRadius: 32,
            border: `2px solid ${accent}80`,
            background: `${accent}10`,
            fontSize: 30, color: "#e2e8f0",
            transform: `scale(${badgeScale})`,
            letterSpacing: 1,
            boxShadow: `inset 0 0 20px ${accent}08, 0 4px 16px rgba(0,0,0,0.3)`,
          }}>
            {badge}
          </div>
        )}

        {/* Decorative line */}
        <div style={{
          width: interpolate(frame, [20, 50], [0, 320], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          height: 3,
          background: `linear-gradient(90deg, transparent, ${accent}60, transparent)`,
          marginTop: 64,
          borderRadius: 2,
        }} />
      </div>

      {narration && <Subtitle text={narration} />}
    </AbsoluteFill>
  );
};
