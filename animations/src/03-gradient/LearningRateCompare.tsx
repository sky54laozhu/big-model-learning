import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

function bezierY(t: number, p0y: number, p1y: number, p2y: number): number {
  return (1 - t) * (1 - t) * p0y + 2 * t * (1 - t) * p1y + t * t * p2y;
}

function valleyY(x: number): number {
  if (x <= 140) {
    const t = x / 140;
    return bezierY(t, 200, 80, 140);
  }
  const t = (x - 140) / 140;
  return bezierY(t, 140, 80, 200);
}

const MiniMountain: React.FC<{
  label: string;
  color: string;
  bgColor: string;
  ballPositions: number[];
  subtitle: string;
  frame: number;
  fps: number;
}> = ({ label, color, bgColor, ballPositions, subtitle, frame, fps }) => {
  const stepsShown = Math.min(
    ballPositions.length,
    Math.floor(
      interpolate(frame, [30, 270], [0, ballPositions.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    )
  );

  const currentIdx = Math.max(0, stepsShown - 1);
  const prevIdx = Math.max(0, currentIdx - 1);

  const stepSpring = spring({
    frame: Math.max(0, frame - 30 - currentIdx * 35),
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  const bx = interpolate(
    stepSpring,
    [0, 1],
    [ballPositions[prevIdx], ballPositions[currentIdx]]
  );
  const by = valleyY(bx) - 8;

  const subtitleOpacity = interpolate(frame, [250, 280], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 320,
        padding: 16,
        borderRadius: 16,
        backgroundColor: bgColor,
        border: `1.5px solid ${color}40`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color,
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <svg viewBox="0 0 280 200" width="280" height="200">
        <path
          d={`M 0 200 Q 60 80 140 140 Q 220 80 280 200`}
          fill={`${color}15`}
          stroke={color}
          strokeWidth={2}
        />
        <line
          x1={140}
          y1={140}
          x2={140}
          y2={200}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="4,3"
          opacity={0.5}
        />

        {/* Trail */}
        {ballPositions.slice(0, stepsShown).map((px, i) => (
          <circle
            key={i}
            cx={px}
            cy={valleyY(px) - 8}
            r={3}
            fill={color}
            opacity={0.3}
          />
        ))}

        {/* Lines between */}
        {ballPositions.slice(0, stepsShown - 1).map((px, i) => (
          <line
            key={i}
            x1={px}
            y1={valleyY(px) - 8}
            x2={ballPositions[i + 1]}
            y2={valleyY(ballPositions[i + 1]) - 8}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4,2"
            opacity={0.4}
          />
        ))}

        {/* Ball */}
        {stepsShown > 0 && (
          <circle cx={bx} cy={by} r={8} fill={color} stroke="#fff" strokeWidth={2} />
        )}
      </svg>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color,
          marginTop: 8,
          opacity: subtitleOpacity,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
};

export const LearningRateCompare: React.FC = () => {
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
          marginBottom: 40,
        }}
      >
        学习率（步幅）的影响
      </div>

      <div style={{ display: "flex", gap: 30, justifyContent: "center" }}>
        <MiniMountain
          label="学习率太大"
          color={COLORS.red}
          bgColor={COLORS.lightRed}

          ballPositions={[50, 230, 60, 220, 70, 210, 80]}
          subtitle="跳过谷底，来回震荡"
          frame={frame}
          fps={fps}
        />
        <MiniMountain
          label="学习率太小"
          color={COLORS.orange}
          bgColor={COLORS.lightOrange}

          ballPositions={[50, 55, 60, 65, 70, 74, 78]}
          subtitle="步子太小，慢得要命"
          frame={frame}
          fps={fps}
        />
        <MiniMountain
          label="学习率合适"
          color={COLORS.green}
          bgColor={COLORS.lightGreen}

          ballPositions={[50, 90, 115, 128, 135, 138, 140]}
          subtitle="稳步走到谷底 ✓"
          frame={frame}
          fps={fps}
        />
      </div>

      <div
        style={{
          marginTop: 40,
          fontSize: 18,
          color: COLORS.textSecondary,
          opacity: interpolate(frame, [270, 290], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        常用学习率：0.001 ~ 0.0001（训练过程中通常会逐步减小）
      </div>
    </AbsoluteFill>
  );
};
