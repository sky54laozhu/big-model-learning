import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, Series, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TitleScene } from "./TitleScene";
import { PhaseCard } from "./PhaseCard";
import { FONT_FAMILY } from "../common/styles";

const FADE = 4;

const SEGMENTS = [
  { id: "hook", frames: 420 },
  { id: "phase1", frames: 478 },
  { id: "phase2", frames: 460 },
  { id: "phase3", frames: 398 },
  { id: "phase4", frames: 380 },
  { id: "phase5", frames: 390 },
  { id: "cta", frames: 248 },
];

export const TRAILER_DURATION = SEGMENTS.reduce((s, seg) => s + seg.frames, 0);

const NARRATIONS: Record<string, string> = {
  hook: "大模型到底是怎么工作的？作为全栈开发者，我决定从零拆解，目标是从程序员变成AI架构师。",
  phase1: "第一阶段·理解大模型：Transformer、Attention、梯度下降，六篇拆透。学完能看懂论文。",
  phase2: "第二阶段·训练的秘密：BPE造词表，预训练获得语言能力，LoRA微调，RLHF对齐。",
  phase3: "第三阶段·推理与部署：KV缓存加速，量化压缩，从权重文件到API服务。",
  phase4: "第四阶段·构建AI应用：上下文工程、RAG、Agent、Multi-Agent协作编排。",
  phase5: "第五阶段·AI架构设计：模型选型、网关、成本优化、安全防护、平台治理。",
  cta: "三十篇，从零到AI架构师。关注我，一起上路。",
};

const FadeWrapper: React.FC<{ children: React.ReactNode; durationInFrames: number }> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - FADE, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
};

const CLIMAX_FRAMES = 50;

const Climax: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const COLORS = ["#3b82f6", "#d97706", "#16a34a", "#7c3aed", "#dc2626"];
  const WORDS = ["Transformer", "梯度下降", "预训练", "LoRA", "KV Cache", "RAG", "Agent", "网关", "安全"];

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a14", fontFamily: FONT_FAMILY }}>
      {WORDS.map((word, i) => {
        const showAt = i * 4;
        const opacity = interpolate(frame, [showAt, showAt + 4, showAt + 12], [0, 1, 0], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp"
        });
        const scale = interpolate(frame, [showAt, showAt + 5], [0.3, 1.6], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp"
        });
        const rotation = interpolate(frame, [showAt, showAt + 5], [-8, 0], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp"
        });
        const x = 80 + (i % 3) * 320;
        const y = 350 + Math.floor(i / 3) * 400;
        return (
          <div key={i} style={{
            position: "absolute", left: x, top: y,
            fontSize: 52, fontWeight: 800,
            color: COLORS[i % COLORS.length],
            opacity, transform: `scale(${scale}) rotate(${rotation}deg)`,
            textShadow: `0 0 40px ${COLORS[i % COLORS.length]}80`,
          }}>
            {word}
          </div>
        );
      })}

      <AbsoluteFill style={{
        backgroundColor: "#ffffff",
        opacity: interpolate(frame, [40, 48], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }} />
    </AbsoluteFill>
  );
};

export const Trailer: React.FC = () => {
  const offsets: number[] = [];
  let cum = 0;
  for (const seg of SEGMENTS) {
    offsets.push(cum);
    cum += seg.frames;
  }

  const ctaStart = offsets[6];
  const climaxStart = ctaStart - CLIMAX_FRAMES;

  return (
    <>
      {/* Audio */}
      {SEGMENTS.map((seg, i) => (
        <Sequence key={seg.id} from={offsets[i]} durationInFrames={seg.frames}>
          <Audio src={staticFile(`audio/trailer/${seg.id}.mp3`)} />
        </Sequence>
      ))}

      {/* Scenes with fades */}
      <Series>
        <Series.Sequence durationInFrames={SEGMENTS[0].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[0].frames}>
            <TitleScene
              title="全栈工程师的&#10;大模型学习笔记"
              subtitle="从零到 AI 架构师 · 30 篇"
              badge="博客 + 视频 · 全程引导式教学"
              narration={NARRATIONS.hook}
              variant="opening"
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[1].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[1].frames}>
            <PhaseCard
              phaseNum={1} phaseName="理解大模型" color="#3b82f6"
              slideFrom="left"
              blogs={["从 if else 到概率预测", "Token 与 Embedding", "梯度下降：模型怎么学习", "Attention 注意力机制", "Transformer 完整架构", "向量基础补课"]}
              milestone="能看懂 Transformer 论文"
              narration={NARRATIONS.phase1}
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[2].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[2].frames}>
            <PhaseCard
              phaseNum={2} phaseName="训练的秘密" color="#d97706"
              slideFrom="right"
              blogs={["Tokenizer：BPE 与词表构建", "预训练：从随机噪声到语言能力", "微调与 LoRA：让通才变专家", "RLHF：对齐人类意图", "模型物理形态：参数与显存"]}
              milestone="能理解任何模型卡片"
              narration={NARRATIONS.phase2}
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[3].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[3].frames}>
            <PhaseCard
              phaseNum={3} phaseName="推理与部署" color="#16a34a"
              slideFrom="left"
              blogs={["KV Cache 与批处理", "量化与蒸馏：大模型瘦身术", "上下文窗口与长文本策略", "模型部署实战"]}
              milestone="能独立部署模型"
              narration={NARRATIONS.phase3}
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[4].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[4].frames}>
            <PhaseCard
              phaseNum={4} phaseName="构建 AI 应用" color="#7c3aed"
              slideFrom="right"
              blogs={["Context Engineering 上下文工程", "结构化输出与工具调用", "RAG 原理 + 工程", "评估与质量度量", "Agent 自主行动", "Multi-Agent 与工作流编排"]}
              milestone="能交付生产级 AI 功能"
              narration={NARRATIONS.phase4}
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[5].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[5].frames}>
            <PhaseCard
              phaseNum={5} phaseName="AI 架构设计" color="#dc2626"
              slideFrom="left"
              blogs={["模型选型与智能路由", "LLM 网关设计", "韧性设计与成本工程", "AI 测试与持续交付", "安全与防护栏", "AI 平台战略与治理"]}
              milestone="能设计完整 AI 平台"
              narration={NARRATIONS.phase5}
            />
          </FadeWrapper>
        </Series.Sequence>

        <Series.Sequence durationInFrames={SEGMENTS[6].frames}>
          <FadeWrapper durationInFrames={SEGMENTS[6].frames}>
            <TitleScene
              title="30 篇&#10;从零到 AI 架构师"
              subtitle="关注我，一起上路"
              badge="全栈工程师的大模型学习笔记"
              narration={NARRATIONS.cta}
              variant="closing"
            />
          </FadeWrapper>
        </Series.Sequence>
      </Series>

      {/* Climax flash before CTA */}
      <Sequence from={climaxStart} durationInFrames={CLIMAX_FRAMES}>
        <Climax />
      </Sequence>
    </>
  );
};
