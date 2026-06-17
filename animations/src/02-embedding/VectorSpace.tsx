import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const WORDS = [
  { label: "猫", emoji: "🐱", targetX: 350, targetY: 200, color: "#dc2626", startX: 100, startY: 400 },
  { label: "狗", emoji: "🐶", targetX: 400, targetY: 240, color: "#ea580c", startX: 800, startY: 100 },
  { label: "鱼", emoji: "🐟", targetX: 320, targetY: 300, color: "#2563eb", startX: 700, startY: 450 },
  { label: "汽车", emoji: "🚗", targetX: 750, targetY: 350, color: "#6b7280", startX: 200, startY: 150 },
  { label: "卡车", emoji: "🚛", targetX: 780, targetY: 400, color: "#9ca3af", startX: 500, startY: 50 },
];

export const VectorSpace: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const axisOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const moveProgress = spring({
    frame: Math.max(0, frame - 40),
    fps,
    config: { damping: 20, stiffness: 40 },
    durationInFrames: 90,
  });

  const lineOpacity = interpolate(frame, [140, 170], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const distanceOpacity = interpolate(frame, [180, 200], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily: FONT_FAMILY,
        padding: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          color: COLORS.text,
          opacity: titleOpacity,
          marginBottom: 10,
        }}
      >
        向量空间：意思相近 = 距离相近
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 20,
        }}
      >
        训练让近义词的向量聚在一起
      </div>

      <div style={{ position: "relative", width: 960, height: 550, margin: "0 auto" }}>
        <svg viewBox="0 0 960 550" width="960" height="550">
          {/* Axes */}
          <line
            x1={60}
            y1={500}
            x2={900}
            y2={500}
            stroke={COLORS.border}
            strokeWidth={2}
            opacity={axisOpacity}
          />
          <line
            x1={60}
            y1={500}
            x2={60}
            y2={50}
            stroke={COLORS.border}
            strokeWidth={2}
            opacity={axisOpacity}
          />
          <text x={900} y={520} fill={COLORS.textSecondary} fontSize={14} fontFamily={FONT_FAMILY} opacity={axisOpacity}>
            维度 1
          </text>
          <text x={20} y={55} fill={COLORS.textSecondary} fontSize={14} fontFamily={FONT_FAMILY} opacity={axisOpacity}>
            维度 2
          </text>

          {/* Cluster circles */}
          {moveProgress > 0.8 && (
            <>
              <circle cx={360} cy={250} r={100} fill="#fef2f240" stroke="#fca5a530" strokeWidth={2} opacity={lineOpacity} />
              <text x={360} y={160} textAnchor="middle" fill={COLORS.red} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={lineOpacity}>
                动物区
              </text>
              <circle cx={765} cy={375} r={70} fill="#f1f5f940" stroke="#cbd5e130" strokeWidth={2} opacity={lineOpacity} />
              <text x={765} y={310} textAnchor="middle" fill={COLORS.textSecondary} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={lineOpacity}>
                车辆区
              </text>
            </>
          )}

          {/* Connection lines */}
          {lineOpacity > 0 && (
            <>
              <line
                x1={WORDS[0].targetX}
                y1={WORDS[0].targetY}
                x2={WORDS[1].targetX}
                y2={WORDS[1].targetY}
                stroke={COLORS.red}
                strokeWidth={1.5}
                strokeDasharray="5,3"
                opacity={lineOpacity * 0.5}
              />
              <line
                x1={WORDS[0].targetX}
                y1={WORDS[0].targetY}
                x2={WORDS[3].targetX}
                y2={WORDS[3].targetY}
                stroke={COLORS.textSecondary}
                strokeWidth={1}
                strokeDasharray="5,3"
                opacity={lineOpacity * 0.3}
              />
            </>
          )}

          {/* Distance labels */}
          {distanceOpacity > 0 && (
            <>
              <text
                x={(WORDS[0].targetX + WORDS[1].targetX) / 2 + 15}
                y={(WORDS[0].targetY + WORDS[1].targetY) / 2 - 8}
                fill={COLORS.red}
                fontSize={13}
                fontWeight={700}
                fontFamily={FONT_FAMILY}
                opacity={distanceOpacity}
              >
                距离: 0.12 (很近！)
              </text>
              <text
                x={(WORDS[0].targetX + WORDS[3].targetX) / 2}
                y={(WORDS[0].targetY + WORDS[3].targetY) / 2 - 8}
                fill={COLORS.textSecondary}
                fontSize={13}
                fontWeight={600}
                fontFamily={FONT_FAMILY}
                opacity={distanceOpacity}
                textAnchor="middle"
              >
                距离: 0.87 (很远)
              </text>
            </>
          )}

          {/* Word dots */}
          {WORDS.map((w, i) => {
            const x = interpolate(moveProgress, [0, 1], [w.startX, w.targetX]);
            const y = interpolate(moveProgress, [0, 1], [w.startY, w.targetY]);
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={22}
                  fill={w.color}
                  stroke="#fff"
                  strokeWidth={3}
                  opacity={0.9}
                />
                <text
                  x={x}
                  y={y + 5}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={16}
                  fontWeight={700}
                  fontFamily={FONT_FAMILY}
                >
                  {w.emoji}
                </text>
                <text
                  x={x}
                  y={y + 40}
                  textAnchor="middle"
                  fill={w.color}
                  fontSize={15}
                  fontWeight={700}
                  fontFamily={FONT_FAMILY}
                >
                  {w.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
