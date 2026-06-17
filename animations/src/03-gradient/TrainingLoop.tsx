import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const STEPS = [
  { label: "训练开始", prob: 0.8, step: 0 },
  { label: "第 1,000 步", prob: 3.2, step: 1000 },
  { label: "第 10,000 步", prob: 22, step: 10000 },
  { label: "第 100,000 步", prob: 78, step: 100000 },
  { label: "训练完成", prob: 96, step: 1000000 },
];

const CYCLE_STEPS = [
  { icon: "📥", label: "算预测", sublabel: "前向传播", color: COLORS.blue },
  { icon: "📏", label: "算损失", sublabel: "对比正确答案", color: COLORS.red },
  { icon: "🧭", label: "算梯度", sublabel: "反向传播", color: COLORS.purple },
  { icon: "🔧", label: "调参数", sublabel: "w -= lr × grad", color: COLORS.green },
];

export const TrainingLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const currentDataStep = Math.min(
    STEPS.length - 1,
    Math.floor(
      interpolate(frame, [40, 260], [0, STEPS.length - 0.01], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    )
  );

  const cycleStep = Math.floor(
    interpolate(frame, [20, 280], [0, 20], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  ) % 4;

  const probValue = interpolate(
    frame,
    STEPS.map((_, i) => 40 + i * 55),
    STEPS.map((s) => s.prob),
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const barWidth = interpolate(probValue, [0, 100], [0, 600], {
    extrapolateRight: "clamp",
  });

  const barColor =
    probValue < 10
      ? COLORS.red
      : probValue < 50
        ? COLORS.orange
        : probValue < 80
          ? COLORS.blue
          : COLORS.green;

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
        训练循环：从瞎猜到精准
      </div>
      <div
        style={{
          fontSize: 20,
          color: COLORS.textSecondary,
          opacity: titleOpacity,
          marginBottom: 30,
        }}
      >
        预测"从前有座山山上有座___"
      </div>

      {/* Four-step cycle */}
      <div style={{ display: "flex", gap: 16, marginBottom: 40 }}>
        {CYCLE_STEPS.map((step, i) => {
          const isActive = cycleStep === i;
          return (
            <div
              key={i}
              style={{
                width: 200,
                padding: "16px 12px",
                borderRadius: 16,
                backgroundColor: isActive ? `${step.color}15` : "#f8fafc",
                border: `2px solid ${isActive ? step.color : COLORS.border}`,
                textAlign: "center",
                transform: isActive ? "scale(1.05)" : "scale(1)",
                transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 32 }}>{step.icon}</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: isActive ? step.color : COLORS.text,
                  marginTop: 4,
                }}
              >
                {step.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  marginTop: 2,
                }}
              >
                {step.sublabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Arrows between steps */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 0,
          marginBottom: 30,
          width: 860,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 20,
              color: COLORS.textSecondary,
            }}
          >
            →
          </div>
        ))}
      </div>

      {/* Probability bar */}
      <div style={{ width: 700, marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: COLORS.text,
            }}
          >
            "庙"的预测概率
          </span>
          <span
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: barColor,
            }}
          >
            {probValue.toFixed(1)}%
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 40,
            borderRadius: 20,
            backgroundColor: "#f1f5f9",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: barWidth,
              height: "100%",
              borderRadius: 20,
              backgroundColor: barColor,
              transition: "background-color 0.3s",
            }}
          />
        </div>
      </div>

      {/* Step milestones */}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        {STEPS.map((s, i) => {
          const isReached = i <= currentDataStep;
          const isCurrent = i === currentDataStep;
          return (
            <div
              key={i}
              style={{
                padding: "10px 18px",
                borderRadius: 12,
                backgroundColor: isCurrent
                  ? `${barColor}15`
                  : isReached
                    ? "#f0fdf4"
                    : "#f8fafc",
                border: `1.5px solid ${isCurrent ? barColor : isReached ? COLORS.green + "40" : COLORS.border}`,
                opacity: isReached ? 1 : 0.4,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isCurrent ? barColor : COLORS.textSecondary,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: isCurrent ? barColor : COLORS.text,
                }}
              >
                {s.prob}%
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
