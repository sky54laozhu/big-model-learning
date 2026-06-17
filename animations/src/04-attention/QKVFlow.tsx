import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const FLOW_STEPS = [
  { label: "原始向量", sublabel: "Embedding 输出", y: 50, color: COLORS.textSecondary },
  { label: "Q / K / V", sublabel: "三组矩阵变换", y: 170, color: COLORS.blue },
  { label: "Q · K 点积", sublabel: "算相似度分数", y: 290, color: COLORS.purple },
  { label: "Softmax", sublabel: "分数 → 权重", y: 410, color: COLORS.orange },
  { label: "权重 × V", sublabel: "加权求和", y: 530, color: COLORS.green },
  { label: "新向量", sublabel: "融合上下文", y: 650, color: COLORS.green },
];

export const QKVFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily: FONT_FAMILY,
        padding: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 800,
          color: COLORS.text,
          opacity: titleOpacity,
          marginBottom: 5,
        }}
      >
        Self-Attention 计算流程
      </div>

      <div style={{ position: "relative", width: 960, height: 750 }}>
        <svg viewBox="0 0 960 760" width="960" height="750">
          {FLOW_STEPS.map((step, i) => {
            const delay = i * 25;
            const appear = spring({
              frame: Math.max(0, frame - 20 - delay),
              fps,
              config: { damping: 15 },
            });

            const boxW = 320;
            const boxH = 70;
            const cx = 480;

            return (
              <g key={i} opacity={appear}>
                {/* Connecting arrow from previous */}
                {i > 0 && (
                  <line
                    x1={cx}
                    y1={step.y - 25}
                    x2={cx}
                    y2={step.y}
                    stroke={step.color}
                    strokeWidth={2}
                    markerEnd={`url(#flow-arrow-${i})`}
                  />
                )}
                <defs>
                  <marker
                    id={`flow-arrow-${i}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M0,0 L10,5 L0,10 z" fill={step.color} />
                  </marker>
                </defs>

                {/* Box */}
                <rect
                  x={cx - boxW / 2}
                  y={step.y}
                  width={boxW}
                  height={boxH}
                  rx={14}
                  fill={`${step.color}10`}
                  stroke={step.color}
                  strokeWidth={2}
                />

                {/* Label */}
                <text
                  x={cx}
                  y={step.y + 30}
                  textAnchor="middle"
                  fill={step.color}
                  fontSize={20}
                  fontWeight={800}
                  fontFamily={FONT_FAMILY}
                >
                  {step.label}
                </text>
                <text
                  x={cx}
                  y={step.y + 52}
                  textAnchor="middle"
                  fill={COLORS.textSecondary}
                  fontSize={14}
                  fontFamily={FONT_FAMILY}
                >
                  {step.sublabel}
                </text>

                {/* Side annotations */}
                {i === 1 && (
                  <>
                    <text x={cx + boxW / 2 + 20} y={step.y + 25} fill={COLORS.blue} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                      Q = "我在找什么"
                    </text>
                    <text x={cx + boxW / 2 + 20} y={step.y + 42} fill={COLORS.blue} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                      K = "我能被谁找到"
                    </text>
                    <text x={cx + boxW / 2 + 20} y={step.y + 59} fill={COLORS.blue} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                      V = "找到后给什么"
                    </text>
                  </>
                )}
                {i === 2 && (
                  <text x={cx + boxW / 2 + 20} y={step.y + 38} fill={COLORS.purple} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                    分数越高 → 越相关
                  </text>
                )}
                {i === 3 && (
                  <text x={cx + boxW / 2 + 20} y={step.y + 38} fill={COLORS.orange} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                    [2.5, 0.1, 2.4] → [0.50, 0.05, 0.45]
                  </text>
                )}
                {i === 5 && (
                  <text x={cx + boxW / 2 + 20} y={step.y + 38} fill={COLORS.green} fontSize={13} fontWeight={600} fontFamily={FONT_FAMILY} opacity={appear}>
                    携带完整上下文信息
                  </text>
                )}
              </g>
            );
          })}

          {/* Data flow particles */}
          {frame > 60 && (
            <>
              {[0, 1, 2].map((p) => {
                const particleFrame = (frame - 60 + p * 30) % 120;
                const py = interpolate(particleFrame, [0, 120], [80, 700], {
                  extrapolateRight: "clamp",
                });
                return (
                  <circle
                    key={p}
                    cx={480 + (p - 1) * 15}
                    cy={py}
                    r={4}
                    fill={COLORS.blue}
                    opacity={0.4}
                  />
                );
              })}
            </>
          )}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
