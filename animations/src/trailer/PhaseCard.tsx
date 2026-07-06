import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILY } from "../common/styles";
import { Subtitle } from "./Subtitle";
import { PHASE_ICON_MAP } from "./Icons";

export const PhaseCard: React.FC<{
  phaseNum: number;
  phaseName: string;
  blogs: string[];
  milestone: string;
  color: string;
  narration: string;
  slideFrom?: "left" | "right";
  totalPhases?: number;
}> = ({ phaseNum, phaseName, blogs, milestone, color, narration, slideFrom = "left", totalPhases = 5 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dir = slideFrom === "left" ? -1 : 1;
  const headerIn = spring({ frame, fps, config: { damping: 10, stiffness: 120, mass: 0.8 } });
  const IconComponent = PHASE_ICON_MAP[phaseNum];

  const milestoneIn = spring({ frame: Math.max(0, frame - 45), fps, config: { damping: 8, stiffness: 160, mass: 1.2 } });
  const milestoneGlow = interpolate(frame, [50, 58, 70], [0, 16, 8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, #10152a 0%, #0c0f1a 65%)", fontFamily: FONT_FAMILY }}>
      {/* Accent strip */}
      <div style={{
        position: "absolute",
        [slideFrom]: 0, top: 0, bottom: 0,
        width: 10,
        background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
        boxShadow: `0 0 20px ${color}40`,
      }} />

      {/* Background glow */}
      <div style={{
        position: "absolute",
        width: 600, height: 600, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}2a 0%, transparent 70%)`,
        left: width / 2 - 300,
        top: height / 2 - 300 + Math.sin(frame * 0.02) * 40,
      }} />

      {/* Progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: "#1e293b" }}>
        <div style={{
          height: "100%",
          width: `${(phaseNum / totalPhases) * 100}%`,
          background: `linear-gradient(90deg, ${color}80, ${color})`,
        }} />
      </div>

      {/* Phase counter */}
      <div style={{
        position: "absolute", top: 40, right: 50,
        fontSize: 24, color: "#94a3b8", fontWeight: 600,
        opacity: headerIn,
      }}>
        {phaseNum}/{totalPhases}
      </div>

      {/* Main content - centered, shifted up for subtitle */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        justifyContent: "center",
        padding: "0 60px",
        paddingBottom: 200,
      }}>
        {/* Icon + Phase header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 20,
          marginBottom: 56,
          transform: `translateX(${(1 - headerIn) * 80 * dir}px) scale(${interpolate(headerIn, [0, 1], [0.9, 1.0])})`,
          opacity: headerIn,
        }}>
          <div style={{
            width: 88, height: 88, borderRadius: 22,
            background: `linear-gradient(135deg, ${color}, ${color}88)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 8px 32px ${color}50`,
            padding: 18,
          }}>
            {IconComponent && <IconComponent />}
          </div>
          <div>
            <div style={{ fontSize: 28, color: `${color}cc`, fontWeight: 600, marginBottom: 6 }}>
              第{["一", "二", "三", "四", "五"][phaseNum - 1]}阶段
            </div>
            <div style={{ fontSize: 48, fontWeight: 800, color: "#fff" }}>
              {phaseName}
            </div>
          </div>
        </div>

        {/* Blog list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28, paddingLeft: 16, marginBottom: 56 }}>
          {blogs.slice(0, 6).map((blog, i) => {
            const delay = 8 + i * 5;
            const itemIn = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 12, stiffness: 140, mass: 0.9 } });
            const dist = i % 2 === 0 ? 50 : 35;
            return (
              <div key={i} style={{
                fontSize: 34, color: "#e2e8f0", fontWeight: 500,
                opacity: itemIn,
                transform: `translateX(${(1 - itemIn) * dist * dir}px) scale(${interpolate(itemIn, [0, 1], [0.96, 1.0])})`,
                display: "flex", alignItems: "center", gap: 16,
                lineHeight: 1.5,
              }}>
                <div style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: color,
                  boxShadow: `0 0 12px ${color}80`,
                  flexShrink: 0,
                }} />
                {blog}
              </div>
            );
          })}
          {blogs.length > 6 && (
            <div style={{
              fontSize: 28, color: `${color}aa`, paddingLeft: 28,
              opacity: interpolate(frame, [35, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}>
              +{blogs.length - 6} 更多...
            </div>
          )}
        </div>

        {/* Milestone */}
        <div style={{
          padding: "20px 36px", borderRadius: 20,
          border: `2px solid ${color}50`,
          background: `${color}10`,
          fontSize: 32, color, fontWeight: 700,
          alignSelf: "flex-start",
          opacity: milestoneIn,
          transform: `translateY(${(1 - milestoneIn) * 30}px) scale(${interpolate(milestoneIn, [0, 1], [0.85, 1.0])})`,
          boxShadow: `0 0 ${milestoneGlow}px ${color}40`,
        }}>
          🏁 {milestone}
        </div>
      </div>

      <Subtitle text={narration} />
    </AbsoluteFill>
  );
};
