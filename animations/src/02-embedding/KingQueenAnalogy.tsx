import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const POINTS = {
  king: { x: 250, y: 150, label: "国王", color: "#7c3aed" },
  man: { x: 200, y: 350, label: "男", color: "#2563eb" },
  woman: { x: 700, y: 350, label: "女", color: "#db2777" },
  queen: { x: 750, y: 150, label: "王后", color: "#dc2626" },
};

export const KingQueenAnalogy: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const pointsAppear = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 15 },
  });

  const arrow1 = interpolate(frame, [50, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const arrow2 = interpolate(frame, [90, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const arrow3 = interpolate(frame, [130, 160], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const formulaOpacity = interpolate(frame, [170, 190], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const queenGlow = spring({
    frame: Math.max(0, frame - 160),
    fps,
    config: { damping: 10, stiffness: 60 },
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
        向量运算 = 语义推理
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 20,
        }}
      >
        模型从数据中自动学会了类比关系
      </div>

      <div style={{ position: "relative", width: 960, height: 480 }}>
        <svg viewBox="0 0 960 480" width="960" height="480">
          <defs>
            <marker id="arrowPurple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS.purple} />
            </marker>
            <marker id="arrowPink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#db2777" />
            </marker>
            <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS.green} />
            </marker>
          </defs>

          {/* Arrow 1: King → Man (subtract) */}
          {arrow1 > 0 && (
            <line
              x1={POINTS.king.x}
              y1={POINTS.king.y + 25}
              x2={interpolate(arrow1, [0, 1], [POINTS.king.x, POINTS.man.x])}
              y2={interpolate(arrow1, [0, 1], [POINTS.king.y + 25, POINTS.man.y - 25])}
              stroke={COLORS.purple}
              strokeWidth={3}
              strokeDasharray="8,4"
              markerEnd="url(#arrowPurple)"
            />
          )}
          {arrow1 > 0.8 && (
            <text x={180} y={260} fill={COLORS.purple} fontSize={16} fontWeight={700} fontFamily={FONT_FAMILY}>
              − 男
            </text>
          )}

          {/* Arrow 2: Man → Woman (offset) */}
          {arrow2 > 0 && (
            <line
              x1={POINTS.man.x + 25}
              y1={POINTS.man.y}
              x2={interpolate(arrow2, [0, 1], [POINTS.man.x + 25, POINTS.woman.x - 25])}
              y2={POINTS.woman.y}
              stroke="#db2777"
              strokeWidth={3}
              strokeDasharray="8,4"
              markerEnd="url(#arrowPink)"
            />
          )}
          {arrow2 > 0.8 && (
            <text x={440} y={380} fill="#db2777" fontSize={16} fontWeight={700} fontFamily={FONT_FAMILY} textAnchor="middle">
              + 女
            </text>
          )}

          {/* Arrow 3: Woman → Queen (result) */}
          {arrow3 > 0 && (
            <line
              x1={POINTS.woman.x}
              y1={POINTS.woman.y - 25}
              x2={interpolate(arrow3, [0, 1], [POINTS.woman.x, POINTS.queen.x])}
              y2={interpolate(arrow3, [0, 1], [POINTS.woman.y - 25, POINTS.queen.y + 25])}
              stroke={COLORS.green}
              strokeWidth={3}
              markerEnd="url(#arrowGreen)"
            />
          )}
          {arrow3 > 0.8 && (
            <text x={760} y={260} fill={COLORS.green} fontSize={16} fontWeight={700} fontFamily={FONT_FAMILY}>
              = 王后！
            </text>
          )}

          {/* Points */}
          {Object.values(POINTS).map((p, i) => {
            const isQueen = p.label === "王后";
            const r = isQueen ? 28 + queenGlow * 8 : 28;
            return (
              <g key={i} opacity={pointsAppear}>
                {isQueen && queenGlow > 0 && (
                  <circle cx={p.x} cy={p.y} r={r + 10} fill={p.color} opacity={0.15 * queenGlow} />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r * pointsAppear}
                  fill={p.color}
                  stroke="#fff"
                  strokeWidth={3}
                />
                <text
                  x={p.x}
                  y={p.y + 7}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={20}
                  fontWeight={800}
                  fontFamily={FONT_FAMILY}
                >
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Formula */}
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: COLORS.text,
          opacity: formulaOpacity,
          padding: "16px 40px",
          borderRadius: 16,
          backgroundColor: "#f8fafc",
          border: `2px solid ${COLORS.border}`,
        }}
      >
        <span style={{ color: POINTS.king.color }}>国王</span>
        {" − "}
        <span style={{ color: POINTS.man.color }}>男</span>
        {" + "}
        <span style={{ color: POINTS.woman.color }}>女</span>
        {" ≈ "}
        <span style={{ color: POINTS.queen.color }}>王后</span>
      </div>
    </AbsoluteFill>
  );
};
