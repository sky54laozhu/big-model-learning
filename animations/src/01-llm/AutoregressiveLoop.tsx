import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const TOKENS = ["从", "前", "有", "座", "山", "山", "上", "有", "座"];
const PREDICTIONS = [
  { char: "庙", prob: 0.7, candidates: [{ c: "庙", p: 0.7 }, { c: "楼", p: 0.12 }, { c: "人", p: 0.08 }, { c: "寺", p: 0.06 }] },
  { char: "庙", prob: 0.85, candidates: [{ c: "庙", p: 0.85 }, { c: "，", p: 0.08 }, { c: "里", p: 0.04 }] },
];

export const AutoregressiveLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const inputPhase = interpolate(frame, [20, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tokensShown = Math.min(
    TOKENS.length,
    Math.ceil(inputPhase * TOKENS.length)
  );

  const barPhase = interpolate(frame, [60, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const selectFlash = interpolate(frame, [105, 115, 125], [0, 1, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const flyIn = spring({
    frame: Math.max(0, frame - 130),
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const showSecondRound = frame > 160;
  const barPhase2 = interpolate(frame, [170, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const prediction = PREDICTIONS[0];

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
        自回归生成：一个字一个字"蹦"
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 40,
        }}
      >
        每次只预测一个 token，拼上去继续预测
      </div>

      {/* Input tokens */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 40,
          padding: "16px 24px",
          borderRadius: 16,
          backgroundColor: "#f8fafc",
          border: `2px solid ${COLORS.border}`,
        }}
      >
        {TOKENS.slice(0, tokensShown).map((t, i) => (
          <div
            key={i}
            style={{
              width: 52,
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 700,
              color: COLORS.text,
              backgroundColor: "#fff",
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            {t}
          </div>
        ))}

        {/* Predicted token flying in */}
        {flyIn > 0.1 && (
          <div
            style={{
              width: 52,
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: COLORS.green,
              borderRadius: 8,
              transform: `scale(${flyIn}) translateY(${(1 - flyIn) * -30}px)`,
              opacity: flyIn,
            }}
          >
            庙
          </div>
        )}

        {/* Second prediction */}
        {showSecondRound && (
          <div
            style={{
              width: 52,
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 600,
              color: COLORS.textSecondary,
              backgroundColor: "#f1f5f9",
              borderRadius: 8,
              border: `2px dashed ${COLORS.border}`,
            }}
          >
            ?
          </div>
        )}
      </div>

      {/* Arrow */}
      <div
        style={{
          fontSize: 32,
          color: COLORS.textSecondary,
          marginBottom: 20,
          opacity: barPhase,
        }}
      >
        ↓ 模型预测下一个 token
      </div>

      {/* Probability bars */}
      <div
        style={{
          width: 600,
          opacity: barPhase,
        }}
      >
        {prediction.candidates.map((c, i) => {
          const isSelected = i === 0;
          const barW = interpolate(barPhase, [0, 1], [0, c.p * 500]);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  fontSize: 24,
                  fontWeight: 700,
                  textAlign: "center",
                  color: isSelected ? COLORS.green : COLORS.text,
                }}
              >
                {c.c}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: "#f1f5f9",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: barW,
                    height: "100%",
                    borderRadius: 8,
                    backgroundColor: isSelected
                      ? selectFlash > 0.5
                        ? COLORS.green
                        : "#86efac"
                      : "#cbd5e1",
                  }}
                />
              </div>
              <div
                style={{
                  width: 60,
                  fontSize: 16,
                  fontWeight: 600,
                  color: isSelected ? COLORS.green : COLORS.textSecondary,
                }}
              >
                {(c.p * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Second round bars */}
      {showSecondRound && barPhase2 > 0 && (
        <div
          style={{
            marginTop: 20,
            fontSize: 16,
            color: COLORS.textSecondary,
            opacity: barPhase2,
          }}
        >
          拼上"庙"后继续预测 → 输入变成"从前有座山山上有座庙"→ 再预测下一个…
        </div>
      )}
    </AbsoluteFill>
  );
};
