import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const TOKENS_DATA = [
  { char: "猫", x: 200, color: "#dc2626", weight: 0.5 },
  { char: "吃", x: 480, color: "#2563eb", weight: 0.1 },
  { char: "鱼", x: 760, color: "#16a34a", weight: 0.4 },
];

export const AttentionWeights: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const tokensAppear = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 15 },
  });

  const focusOnEat = interpolate(frame, [50, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const linesAppear = interpolate(frame, [70, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const weightsAppear = interpolate(frame, [110, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fusionProgress = spring({
    frame: Math.max(0, frame - 150),
    fps,
    config: { damping: 12, stiffness: 60 },
  });

  const resultAppear = interpolate(frame, [190, 220], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eatToken = TOKENS_DATA[1];
  const tokenY = 180;
  const newVectorY = 450;

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
        Attention：按权重融合信息
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 20,
        }}
      >
        "吃"看看其他 token，按相关性分配注意力
      </div>

      <div style={{ position: "relative", width: 960, height: 550 }}>
        <svg viewBox="0 0 960 600" width="960" height="550">
          {/* Token boxes */}
          {TOKENS_DATA.map((t, i) => {
            const isCenter = i === 1;
            const glow = isCenter ? focusOnEat : 0;
            return (
              <g key={i} opacity={tokensAppear}>
                {glow > 0 && (
                  <rect
                    x={t.x - 40}
                    y={tokenY - 35}
                    width={80}
                    height={70}
                    rx={18}
                    fill={t.color}
                    opacity={0.1 * glow}
                  />
                )}
                <rect
                  x={t.x - 35}
                  y={tokenY - 30}
                  width={70}
                  height={60}
                  rx={14}
                  fill={isCenter && focusOnEat > 0.5 ? `${t.color}20` : "#f8fafc"}
                  stroke={t.color}
                  strokeWidth={isCenter && focusOnEat > 0.5 ? 3 : 2}
                />
                <text
                  x={t.x}
                  y={tokenY + 8}
                  textAnchor="middle"
                  fill={t.color}
                  fontSize={28}
                  fontWeight={800}
                  fontFamily={FONT_FAMILY}
                >
                  {t.char}
                </text>
              </g>
            );
          })}

          {/* Attention lines from "吃" to others */}
          {TOKENS_DATA.map((t, i) => {
            const lineWidth = t.weight * 8;
            return (
              <g key={`line-${i}`} opacity={linesAppear}>
                <line
                  x1={eatToken.x}
                  y1={tokenY + 35}
                  x2={t.x}
                  y2={tokenY + 100}
                  stroke={t.color}
                  strokeWidth={lineWidth * linesAppear}
                  opacity={0.6}
                />
                {/* Weight label */}
                {weightsAppear > 0 && (
                  <g opacity={weightsAppear}>
                    <rect
                      x={t.x - 28}
                      y={tokenY + 100}
                      width={56}
                      height={28}
                      rx={8}
                      fill={t.color}
                      opacity={0.15}
                    />
                    <text
                      x={t.x}
                      y={tokenY + 119}
                      textAnchor="middle"
                      fill={t.color}
                      fontSize={15}
                      fontWeight={700}
                      fontFamily={FONT_FAMILY}
                    >
                      {t.weight}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Fusion arrows going down */}
          {fusionProgress > 0.1 && TOKENS_DATA.map((t, i) => (
            <line
              key={`fusion-${i}`}
              x1={t.x}
              y1={tokenY + 135}
              x2={eatToken.x}
              y2={interpolate(fusionProgress, [0, 1], [tokenY + 135, newVectorY - 30])}
              stroke={t.color}
              strokeWidth={2}
              strokeDasharray="5,3"
              opacity={fusionProgress * 0.5}
            />
          ))}

          {/* New vector */}
          {resultAppear > 0 && (
            <g opacity={resultAppear}>
              <rect
                x={eatToken.x - 100}
                y={newVectorY - 25}
                width={200}
                height={50}
                rx={14}
                fill="#f0fdf4"
                stroke={COLORS.green}
                strokeWidth={2.5}
              />
              <text
                x={eatToken.x}
                y={newVectorY + 8}
                textAnchor="middle"
                fill={COLORS.green}
                fontSize={18}
                fontWeight={700}
                fontFamily={FONT_FAMILY}
              >
                "吃"的新向量
              </text>
              <text
                x={eatToken.x}
                y={newVectorY + 65}
                textAnchor="middle"
                fill={COLORS.textSecondary}
                fontSize={14}
                fontFamily={FONT_FAMILY}
              >
                融合了"谁在吃"和"吃什么"的信息
              </text>
            </g>
          )}

          {/* Formula */}
          {resultAppear > 0.5 && (
            <text
              x={eatToken.x}
              y={newVectorY + 100}
              textAnchor="middle"
              fill={COLORS.text}
              fontSize={16}
              fontWeight={600}
              fontFamily={FONT_FAMILY}
              opacity={resultAppear}
            >
              = 猫×0.5 + 吃×0.1 + 鱼×0.4
            </text>
          )}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
