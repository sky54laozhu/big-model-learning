import React from "react";
import { Composition } from "remotion";

import { AutoregressiveLoop } from "./01-llm/AutoregressiveLoop";
import { ProbabilityShift } from "./01-llm/ProbabilityShift";
import { VectorSpace } from "./02-embedding/VectorSpace";
import { KingQueenAnalogy } from "./02-embedding/KingQueenAnalogy";
import { MountainDescent } from "./03-gradient/MountainDescent";
import { GradientArrows } from "./03-gradient/GradientArrows";
import { LearningRateCompare } from "./03-gradient/LearningRateCompare";
import { TrainingLoop } from "./03-gradient/TrainingLoop";
import { AttentionWeights } from "./04-attention/AttentionWeights";
import { QKVFlow } from "./04-attention/QKVFlow";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 第1章：从 if-else 到概率预测 */}
      <Composition
        id="01-AutoregressiveLoop"
        component={AutoregressiveLoop}
        durationInFrames={8 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="01-ProbabilityShift"
        component={ProbabilityShift}
        durationInFrames={6 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* 第2章：Token 与 Embedding */}
      <Composition
        id="02-VectorSpace"
        component={VectorSpace}
        durationInFrames={8 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="02-KingQueenAnalogy"
        component={KingQueenAnalogy}
        durationInFrames={8 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* 第3章：梯度下降（重点） */}
      <Composition
        id="03-MountainDescent"
        component={MountainDescent}
        durationInFrames={10 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="03-GradientArrows"
        component={GradientArrows}
        durationInFrames={7 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="03-LearningRateCompare"
        component={LearningRateCompare}
        durationInFrames={10 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="03-TrainingLoop"
        component={TrainingLoop}
        durationInFrames={10 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* 第4章：Attention */}
      <Composition
        id="04-AttentionWeights"
        component={AttentionWeights}
        durationInFrames={8 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="04-QKVFlow"
        component={QKVFlow}
        durationInFrames={10 * FPS}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
