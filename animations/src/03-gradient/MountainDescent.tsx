import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../common/styles";

const MOUNTAIN_PATH =
  "M 0 400 Q 150 100 300 280 Q 380 340 480 200 Q 530 140 580 200 Q 680 340 760 260 Q 860 100 1000 400";

function getMountainY(x: number): number {
  const points = [
    [0, 400],
    [150, 100],
    [300, 280],
    [380, 340],
    [480, 200],
    [530, 140],
    [580, 200],
    [680, 340],
    [760, 260],
    [860, 100],
    [1000, 400],
  ];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 400;
}

const BALL_STEPS = [
  { x: 180, loss: 4.6 },
  { x: 280, loss: 3.8 },
  { x: 360, loss: 3.1 },
  { x: 440, loss: 2.2 },
  { x: 500, loss: 1.5 },
  { x: 530, loss: 0.8 },
  { x: 545, loss: 0.3 },
];

export const MountainDescent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const mountainDraw = interpolate(frame, [10, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const currentStep = Math.min(
    BALL_STEPS.length - 1,
    Math.floor(interpolate(frame, [50, 250], [0, BALL_STEPS.length - 0.01], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }))
  );

  const stepProgress = spring({
    frame: Math.max(0, frame - 50 - currentStep * 30),
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  const prevStep = Math.max(0, currentStep - 1);
  const ballX = interpolate(
    stepProgress,
    [0, 1],
    [BALL_STEPS[prevStep].x, BALL_STEPS[currentStep].x]
  );
  const ballY = getMountainY(ballX) - 12;
  const currentLoss = interpolate(
    stepProgress,
    [0, 1],
    [BALL_STEPS[prevStep].loss, BALL_STEPS[currentStep].loss]
  );

  const showArrow = frame > 50 && currentStep < BALL_STEPS.length - 1;

  const finalGlow =
    currentStep === BALL_STEPS.length - 1
      ? interpolate(frame, [250, 270], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

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
          marginBottom: 20,
        }}
      >
        梯度下降 = 蒙眼下山
      </div>

      <div style={{ position: "relative", width: 1000, height: 450, margin: "0 auto" }}>
        <svg viewBox="0 0 1000 450" width="1000" height="450">
          <defs>
            <linearGradient id="mtnGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#86efac" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#dcfce7" stopOpacity={0.3} />
            </linearGradient>
          </defs>

          {/* Mountain */}
          <path
            d={MOUNTAIN_PATH + " L 1000 450 L 0 450 Z"}
            fill="url(#mtnGrad)"
            stroke={COLORS.mountainStroke}
            strokeWidth={2.5}
            opacity={mountainDraw}
          />

          {/* Valley marker */}
          <line
            x1={535}
            y1={140}
            x2={535}
            y2={420}
            stroke={COLORS.green}
            strokeWidth={1.5}
            strokeDasharray="6,4"
            opacity={mountainDraw * 0.7}
          />
          <text
            x={535}
            y={438}
            textAnchor="middle"
            fill={COLORS.green}
            fontSize={14}
            fontWeight={700}
            fontFamily={FONT_FAMILY}
            opacity={mountainDraw}
          >
            谷底：损失最小
          </text>

          {/* Trail dots */}
          {BALL_STEPS.slice(0, currentStep + 1).map((step, i) => (
            <circle
              key={i}
              cx={step.x}
              cy={getMountainY(step.x) - 12}
              r={i === currentStep ? 0 : 4}
              fill={COLORS.red}
              opacity={0.4}
            />
          ))}

          {/* Gradient arrow */}
          {showArrow && (
            <line
              x1={ballX + 5}
              y1={ballY}
              x2={BALL_STEPS[currentStep + 1]?.x ?? ballX}
              y2={getMountainY(BALL_STEPS[currentStep + 1]?.x ?? ballX) - 12}
              stroke={COLORS.red}
              strokeWidth={2}
              strokeDasharray="5,3"
              opacity={0.6}
              markerEnd="url(#arrowHead)"
            />
          )}
          <defs>
            <marker
              id="arrowHead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS.red} />
            </marker>
          </defs>

          {/* Ball */}
          {frame > 45 && (
            <>
              {finalGlow > 0 && (
                <circle
                  cx={ballX}
                  cy={ballY}
                  r={18 + finalGlow * 8}
                  fill={COLORS.green}
                  opacity={0.2 * finalGlow}
                />
              )}
              <circle
                cx={ballX}
                cy={ballY}
                r={14}
                fill={currentStep === BALL_STEPS.length - 1 ? COLORS.green : COLORS.red}
                stroke="#fff"
                strokeWidth={3}
              />
            </>
          )}

          {/* Start label */}
          {frame > 45 && currentStep === 0 && (
            <text
              x={ballX}
              y={ballY - 25}
              textAnchor="middle"
              fill={COLORS.red}
              fontSize={13}
              fontWeight={700}
              fontFamily={FONT_FAMILY}
            >
              起点（随机初始化）
            </text>
          )}

          {/* End label */}
          {currentStep === BALL_STEPS.length - 1 && finalGlow > 0 && (
            <text
              x={ballX}
              y={ballY - 25}
              textAnchor="middle"
              fill={COLORS.green}
              fontSize={14}
              fontWeight={700}
              fontFamily={FONT_FAMILY}
              opacity={finalGlow}
            >
              到达谷底！
            </text>
          )}
        </svg>
      </div>

      {/* Loss display */}
      {frame > 45 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 40,
            marginTop: 20,
          }}
        >
          <div
            style={{
              padding: "16px 32px",
              borderRadius: 12,
              backgroundColor: COLORS.lightRed,
              border: `1px solid ${COLORS.border}`,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            损失 Loss ={" "}
            <span style={{ color: currentLoss > 1 ? COLORS.red : COLORS.green }}>
              {currentLoss.toFixed(1)}
            </span>
          </div>
          <div
            style={{
              padding: "16px 32px",
              borderRadius: 12,
              backgroundColor: COLORS.lightBlue,
              border: `1px solid ${COLORS.border}`,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            第 {currentStep + 1} / {BALL_STEPS.length} 步
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
