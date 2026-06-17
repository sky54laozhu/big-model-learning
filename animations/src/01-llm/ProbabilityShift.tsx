import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const CONTEXTS = [
  {
    label: "朋友圈",
    color: COLORS.blue,
    bg: COLORS.lightBlue,
    probs: [
      { c: "吃", p: 0.7 },
      { c: "看", p: 0.12 },
      { c: "闻", p: 0.05 },
      { c: "香", p: 0.03 },
    ],
  },
  {
    label: "摄影杂志",
    color: COLORS.purple,
    bg: "#f5f3ff",
    probs: [
      { c: "看", p: 0.65 },
      { c: "吃", p: 0.1 },
      { c: "拍", p: 0.08 },
      { c: "美", p: 0.06 },
    ],
  },
];

export const ProbabilityShift: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const switchProgress = interpolate(frame, [90, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const contextIdx = switchProgress < 0.5 ? 0 : 1;
  const ctx = CONTEXTS[contextIdx];

  const barProgress = contextIdx === 0
    ? interpolate(frame, [30, 70], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : interpolate(frame, [115, 155], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  const labelSwitch = spring({
    frame: Math.max(0, frame - 90),
    fps,
    config: { damping: 15 },
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
        同样的文字，不同的概率
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 40,
        }}
      >
        上下文不同 → 概率分布完全不同
      </div>

      {/* Input text */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          padding: "16px 40px",
          borderRadius: 16,
          backgroundColor: "#f8fafc",
          border: `2px solid ${COLORS.border}`,
          marginBottom: 30,
        }}
      >
        这家餐厅的菜真好
        <span
          style={{
            display: "inline-block",
            width: 40,
            height: 40,
            lineHeight: "40px",
            textAlign: "center",
            backgroundColor: ctx.bg,
            border: `2px dashed ${ctx.color}`,
            borderRadius: 8,
            marginLeft: 4,
            color: ctx.color,
            fontSize: 28,
          }}
        >
          ?
        </span>
      </div>

      {/* Context tag */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 30,
        }}
      >
        {CONTEXTS.map((c, i) => (
          <div
            key={i}
            style={{
              padding: "10px 28px",
              borderRadius: 24,
              backgroundColor: contextIdx === i ? c.bg : "#f8fafc",
              border: `2px solid ${contextIdx === i ? c.color : COLORS.border}`,
              fontSize: 18,
              fontWeight: contextIdx === i ? 700 : 400,
              color: contextIdx === i ? c.color : COLORS.textSecondary,
              transform: contextIdx === i ? "scale(1.08)" : "scale(1)",
            }}
          >
            {contextIdx === i ? "▸ " : ""}
            {c.label}
          </div>
        ))}
      </div>

      {/* Probability bars */}
      <div style={{ width: 600 }}>
        {ctx.probs.map((item, i) => {
          const barW = interpolate(barProgress, [0, 1], [0, item.p * 500]);
          const isTop = i === 0;
          return (
            <div
              key={`${contextIdx}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 50,
                  fontSize: 28,
                  fontWeight: 700,
                  textAlign: "center",
                  color: isTop ? ctx.color : COLORS.text,
                }}
              >
                {item.c}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: "#f1f5f9",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: barW,
                    height: "100%",
                    borderRadius: 10,
                    backgroundColor: isTop ? ctx.color : "#cbd5e1",
                  }}
                />
              </div>
              <div
                style={{
                  width: 70,
                  fontSize: 18,
                  fontWeight: 700,
                  color: isTop ? ctx.color : COLORS.textSecondary,
                }}
              >
                {(item.p * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
