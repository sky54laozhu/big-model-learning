import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

export const GradientArrows: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const gridOpacity = interpolate(frame, [15, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const contourColors = ["#dc262620", "#f59e0b25", "#fde68a40", "#dcfce750", "#86efac60"];
  const contourRadii = [360, 290, 220, 150, 80];

  const pointAppear = spring({
    frame: Math.max(0, frame - 45),
    fps,
    config: { damping: 15 },
  });

  const arrowsProgress = interpolate(frame, [70, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const resultArrow = spring({
    frame: Math.max(0, frame - 140),
    fps,
    config: { damping: 12 },
  });

  const labelOpacity = interpolate(frame, [80, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cx = 480;
  const cy = 350;
  const px = 300;
  const py = 200;

  const arrows = [
    { dx: -40, dy: -30, label: "w₁ 方向", color: "#dc2626" },
    { dx: 15, dy: -35, label: "w₂ 方向", color: "#2563eb" },
    { dx: -25, dy: 10, label: "w₃ 方向", color: "#7c3aed" },
    { dx: 30, dy: 5, label: "w₄ 方向", color: "#d97706" },
  ];

  const gradientDx = arrows.reduce((sum, a) => sum + a.dx, 0) * 0.6;
  const gradientDy = arrows.reduce((sum, a) => sum + a.dy, 0) * 0.6;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily: FONT_FAMILY,
        padding: 60,
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          textAlign: "center",
          color: COLORS.text,
          opacity: titleOpacity,
          marginBottom: 10,
        }}
      >
        梯度：一次算出所有方向
      </div>
      <div
        style={{
          fontSize: 20,
          textAlign: "center",
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 20,
        }}
      >
        等高线图：从高处（外圈）到低处（中心）
      </div>

      <div style={{ position: "relative", width: 960, height: 600, margin: "0 auto" }}>
        <svg viewBox="0 0 960 700" width="960" height="600">
          {/* Contour rings */}
          {contourRadii.map((r, i) => (
            <ellipse
              key={i}
              cx={cx}
              cy={cy}
              rx={r}
              ry={r * 0.65}
              fill={contourColors[i]}
              stroke={contourColors[i].replace(/\d{2}$/, "80")}
              strokeWidth={1.5}
              opacity={gridOpacity}
            />
          ))}

          {/* Center label */}
          <text
            x={cx}
            y={cy + 5}
            textAnchor="middle"
            fill={COLORS.green}
            fontSize={14}
            fontWeight={700}
            fontFamily={FONT_FAMILY}
            opacity={gridOpacity}
          >
            最小损失
          </text>

          {/* Current point */}
          <circle
            cx={px}
            cy={py}
            r={10 * pointAppear}
            fill={COLORS.red}
            stroke="#fff"
            strokeWidth={2}
          />
          {pointAppear > 0.5 && (
            <text
              x={px}
              y={py - 18}
              textAnchor="middle"
              fill={COLORS.red}
              fontSize={13}
              fontWeight={700}
              fontFamily={FONT_FAMILY}
              opacity={pointAppear}
            >
              当前位置
            </text>
          )}

          {/* Individual dimension arrows */}
          {arrows.map((a, i) => {
            const delay = i * 0.2;
            const progress = Math.max(
              0,
              Math.min(1, (arrowsProgress - delay) / (1 - delay))
            );
            return (
              <g key={i} opacity={progress}>
                <line
                  x1={px}
                  y1={py}
                  x2={px + a.dx * 2.5 * progress}
                  y2={py + a.dy * 2.5 * progress}
                  stroke={a.color}
                  strokeWidth={2}
                  strokeDasharray="4,2"
                />
                <text
                  x={px + a.dx * 3}
                  y={py + a.dy * 3}
                  textAnchor="middle"
                  fill={a.color}
                  fontSize={12}
                  fontWeight={600}
                  fontFamily={FONT_FAMILY}
                  opacity={labelOpacity}
                >
                  {a.label}
                </text>
              </g>
            );
          })}

          {/* Combined gradient arrow */}
          {resultArrow > 0.1 && (
            <g opacity={resultArrow}>
              <defs>
                <marker
                  id="bigArrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill={COLORS.green} />
                </marker>
              </defs>
              <line
                x1={px}
                y1={py}
                x2={px + gradientDx * resultArrow}
                y2={py + gradientDy * resultArrow}
                stroke={COLORS.green}
                strokeWidth={4}
                markerEnd="url(#bigArrow)"
              />
              <text
                x={px + gradientDx + 10}
                y={py + gradientDy - 10}
                fill={COLORS.green}
                fontSize={16}
                fontWeight={800}
                fontFamily={FONT_FAMILY}
              >
                梯度方向（合力）
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Bottom explanation */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 30,
          marginTop: 10,
          opacity: interpolate(frame, [100, 120], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            padding: "12px 24px",
            borderRadius: 12,
            backgroundColor: COLORS.lightBlue,
            fontSize: 18,
            fontWeight: 600,
            color: COLORS.blue,
          }}
        >
          每个维度的偏导数 → 组合成梯度向量
        </div>
        <div
          style={{
            padding: "12px 24px",
            borderRadius: 12,
            backgroundColor: COLORS.lightGreen,
            fontSize: 18,
            fontWeight: 600,
            color: COLORS.green,
          }}
        >
          一次计算，所有方向
        </div>
      </div>
    </AbsoluteFill>
  );
};
