/* eslint-disable react-native/no-inline-styles */
/**
 * QuizResultCard.tsx  –  React Native + @shopify/react-native-skia v1+
 *
 * Image URL rules:
 *   - profile image       → truyền vào qua prop `profileUri`
 *   - background / image  → BASE_IMAGE_URL + overlay.src  (hoặc result.image)
 *
 * BASE_IMAGE_URL = "https://res.cloudinary.com/dr7qgoamh/image/upload/v1714101427/gametucthoi/static/images/"
 */

import React, {  useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Canvas,
  Circle,
  ColorMatrix,
  Fill,
  FontSlant,
  FontWeight,
  Group,
  Image as SkImage,
  LinearGradient,
  Paint,
  Paragraph,
  Path,
  Rect,
  Skia,
  TextAlign,
  useImage,
  vec,
} from "@shopify/react-native-skia";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_IMAGE_URL =
  "https://res.cloudinary.com/dr7qgoamh/image/upload/v1714101427/gametucthoi/static/images/";

// ─── Types ────────────────────────────────────────────────────────────────────

type TA = "left" | "center" | "right";
type VA = "top" | "middle" | "bottom";

interface BaseOverlay {
  x: number;
  y: number;
  w: number;
  h: number;
  a?: number;
}

export interface BackgroundOverlay extends BaseOverlay {
  type: "background";
  src: string;
  effect?: string;
  data?: {
    dataset: string[];
    operation?: {
      operands: Record<string, number[]>;
      operator: "random" | "general" | string; // e.g. "image0" → lookup by selectedAnswers
    };
  };
}

export interface ProfileOverlay extends BaseOverlay {
  type: "profile";
  effect?: string; // "GrayScale" | "mask" | "none"
  fl?: boolean;
  flv?: boolean;
  m?: string;      // mask image filename
}

export interface TextOverlay extends BaseOverlay {
  type: "text";
  t: string | string[];
  c: string;
  f: string;
  fs: number;
  ta: TA;
  va: VA;
  uc: boolean;
  sb?: boolean;
  si?: boolean;
  st?: boolean;
  stcl?: string;
  lw?: number;
  hl?: number | false;
  data?: {
    // dataset có thể là string[] hoặc string[][] (2D — chọn theo selectedAnswers)
    dataset: string[] | string[][];
    operation?: {
      operands: Record<string, unknown>;
      operator: string;
    };
  };
}

export type Overlay = BackgroundOverlay | ProfileOverlay | TextOverlay;

export interface QuizOption {
  src: string;
  title: string;
}

export interface QuizQuestion {
  action: string;
  type: string;
  var: string;           // e.g. "image0"
  isRandom: boolean;
  showText: boolean;
  image: boolean;
  imageUrl: string;
  options: Record<string, QuizOption>;
}

export interface ResultConfig {
  width: number;
  height: number;
  image: string;
  overlays: Overlay[];
}

export interface QuizData {
  quiz: { name: string; title?: string; desc?: string; id: number };
  question: QuizQuestion[];
  result: ResultConfig[];
}

export interface QuizResultCardProps {
  userName: string;
  jsonData: QuizData;
  /** URI của ảnh đại diện người dùng — truyền từ ngoài vào */
  profileUri?: string;
  variantIndex?: number;
  /** Ref để gọi makeImageSnapshot() từ bên ngoài */
  canvasRef?: React.RefObject<any>;
}

// ─── Grayscale matrix ─────────────────────────────────────────────────────────

const GRAYSCALE_MATRIX = [
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0,      0,      0,      1, 0,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ghép BASE_IMAGE_URL + path tương đối */
function buildImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("file://")) return path;
  return `${BASE_IMAGE_URL}${path}`;
}

/**
 * Evaluate @{rand(min,max)} expressions in a string.
 * Each occurrence is replaced independently with a new random integer in [min, max].
 */
function evalRandExpressions(text: string): string {
  return text.replace(/@\{rand\((\d+),(\d+)\)\}/g, (_match, minStr, maxStr) => {
    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  });
}

/**
 * Replace date/time tokens:
 *   day_now       → ngày hiện tại (1-31)
 *   month_now     → tháng hiện tại (1-12)
 *   fullYear_now  → năm hiện tại (vd: 2025)
 *   hour_now      → giờ (0-23)
 *   minute_now    → phút (0-59)
 *   second_now    → giây (0-59)
 */
function evalDateTokens(text: string): string {
  const now = new Date();
  return text
    .replace(/day_now/g,      String(now.getDate()))
    .replace(/month_now/g,    String(now.getMonth() + 1))
    .replace(/fullYear_now/g, String(now.getFullYear()))
    .replace(/hour_now/g,     String(now.getHours()))
    .replace(/minute_now/g,   String(now.getMinutes()))
    .replace(/second_now/g,   String(now.getSeconds()));
}

/**
 * Resolve text từ overlay.
 *
 * dataset có 2 dạng:
 *   - string[]    → chọn theo variantIndex (như cũ)
 *   - string[][]  → chọn hàng theo selectedAnswers[operator], rồi chọn phần tử theo variantIndex
 *
 * @image_text(varName) → title của option user đã chọn (từ selectedOptions)
 */
function resolveText(
  overlay: TextOverlay,
  userName: string,
  idx: number,
  selectedAnswers?: Record<string, number>,
  selectedOptions?: Record<string, string>, // varName → option title
): string {
  const dataset = overlay.data?.dataset;
  const operator = overlay.data?.operation?.operator ?? "general";

  let tpl = "";

  if ((overlay.t === "" || overlay.t === undefined) && dataset?.length) {
    if (Array.isArray(dataset[0])) {
      // 2D dataset: dataset[rowIndex][itemIndex]
      // rowIndex từ selectedAnswers[operator], fallback variantIndex
      const rowIndex = selectedAnswers?.[operator] ?? (idx % dataset.length);
      const row = dataset[rowIndex] as string[];
      tpl = row[idx % row.length] ?? "";
    } else {
      // 1D dataset
      tpl = (dataset as string[])[idx % dataset.length] ?? "";
    }
  } else {
    const source = overlay.t;
    tpl = Array.isArray(source) ? source[idx % source.length] : (source ?? "");
  }

  // Replace nm_name
  let result = tpl.replace(/nm_name/g, userName);

  // Replace @image_text(varName) → title của option đã chọn
  result = result.replace(/@image_text\(([^)]+)\)/g, (_m, varName) => {
    return selectedOptions?.[varName] ?? "";
  });

  // Evaluate @{rand(min,max)} and date tokens
  return evalDateTokens(evalRandExpressions(result));
}

const FONT_FAMILY_MAP: Record<string, string> = {
  arial:                Platform.OS === "ios" ? "Helvetica Neue" : "sans-serif",
  greatvibes:           "GreatVibes-Regular",
  "greatvibes-regular": "GreatVibes-Regular",
  "lora-regular":       "Lora-Regular",
  lora:                 "Lora-Regular",
  "playball-regular":   "Playball-Regular",
  playball:             "Playball-Regular",
  roboto:               "Roboto",
  opensans:             "OpenSans-Regular",
  "opensans-regular":   "OpenSans-Regular",
  lato:                 "Lato-Regular",
  "lato-regular":       "Lato-Regular",
  montserrat:           "Montserrat-Regular",
  "montserrat-regular": "Montserrat-Regular",
  verdana:              Platform.OS === "ios" ? "Verdana" : "sans-serif",
  georgia:              Platform.OS === "ios" ? "Georgia" : "serif",
};

/**
 * Resolve font family từ JSON key.
 * Nếu không tìm thấy trong map, trả về chính key đó
 * (cho phép dùng tên font native trực tiếp).
 */

function resolveFontFamily(key: string): string {
  return FONT_FAMILY_MAP[key?.toLowerCase()] ?? key ?? "sans-serif";
}

const TA_MAP: Record<TA, TextAlign> = {
  left:   TextAlign.Left,
  center: TextAlign.Center,
  right:  TextAlign.Right,
};

// ─── BackgroundLayer ──────────────────────────────────────────────────────────

function BackgroundLayer({
  overlay,
  scale,
  variantIndex,
  selectedAnswers,
}: {
  overlay: BackgroundOverlay;
  scale: number;
  variantIndex: number;
  selectedAnswers?: Record<string, number>;
}) {
  // Resolve src:
  //   1. overlay.src có giá trị → dùng trực tiếp
  //   2. src rỗng + data.dataset[] → chọn theo variantIndex (random operator)
  const resolvedSrc = (() => {
    if (overlay.src) return overlay.src;
    const dataset = overlay.data?.dataset;
    if (!dataset?.length) return "";
    const operator = overlay.data?.operation?.operator ?? "general";

    if (operator === "random") {
      return dataset[Math.floor(Math.random() * dataset.length)];
    }

    // operator là varName (e.g. "image0") → lookup index từ selectedAnswers
    if (operator !== "general" && selectedAnswers?.[operator] !== undefined) {
      const idx = selectedAnswers[operator];
      return dataset[idx] ?? dataset[0];
    }

    // general / fallback → variantIndex
    return dataset[variantIndex % dataset.length];
  })();

  const url   = buildImageUrl(resolvedSrc);
  const image = useImage(url || null);

  const sx = overlay.x * scale;
  const sy = overlay.y * scale;
  const sw = overlay.w * scale;
  const sh = overlay.h * scale;

  if (!image) {
    return (
      <Rect x={sx} y={sy} width={sw} height={sh}>
        <LinearGradient
          start={vec(sx, sy)}
          end={vec(sx + sw, sy + sh)}
          colors={["#1a1a2e", "#16213e", "#0f3460"]}
        />
      </Rect>
    );
  }

  return <SkImage image={image} x={sx} y={sy} width={sw} height={sh} fit="cover" />;
}

// ─── ProfileLayer ─────────────────────────────────────────────────────────────

function ProfileLayer({
  overlay,
  profileUri,
  scale,
}: {
  overlay: ProfileOverlay;
  profileUri: string;
  scale: number;
}) {
  // Profile image: URI trực tiếp từ props (camera roll, remote avatar...)
  const profileImage = useImage(profileUri || null);

  // Mask image: path tương đối → ghép BASE_IMAGE_URL
  const maskUrl   = overlay.m ? buildImageUrl(overlay.m) : null;
  const maskImage = useImage(maskUrl);

  const ox = overlay.x * scale;
  const oy = overlay.y * scale;
  const ow = overlay.w * scale;
  const oh = overlay.h * scale;
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  const r  = Math.min(ow, oh) / 2;

  const effect = overlay.effect?.toLowerCase() ?? "none";

  // Rotation: xoay quanh tâm của overlay box (cx, cy)
  const a = overlay.a ?? 0;
  const rotationTransform = a !== 0 ? [
    { translateX: cx },
    { translateY: cy },
    { rotate: (a * Math.PI) / 180 },
    { translateX: -cx },
    { translateY: -cy },
  ] : undefined;

  const circleClip = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(cx, cy, r);
    return p;
  }, [cx, cy, r]);

  const placeholder = (
    <>
      <Rect x={ox} y={oy} width={ow} height={oh}>
        <LinearGradient
          start={vec(ox, oy)}
          end={vec(ox + ow, oy + oh)}
          colors={["#667eea", "#764ba2"]}
        />
      </Rect>
      <Circle cx={cx} cy={cy - r * 0.2} r={r * 0.37} color="rgba(255,255,255,0.85)" />
      <Path
        path={(() => {
          const p = Skia.Path.Make();
          p.addArc(
            { x: cx - r * 0.46, y: cy + r * 0.22, width: r * 0.92, height: r * 0.64 },
            180, 180
          );
          p.close();
          return p;
        })()}
        color="rgba(255,255,255,0.85)"
      />
    </>
  );

  // Helper: wrap content với rotation nếu có
  function withRotation(children: React.ReactNode) {
    if (!rotationTransform) return <Group>{children}</Group>;
    return <Group transform={rotationTransform}>{children}</Group>;
  }

  // ── effect: mask ─────────────────────────────────────────────────────────────
  if (effect === "mask" && maskImage) {
    return withRotation(
      <>
        {profileImage ? (
          <SkImage image={profileImage} x={ox} y={oy} width={ow} height={oh} fit="cover" />
        ) : placeholder}
        <SkImage image={maskImage} x={ox} y={oy} width={ow} height={oh} fit="cover">
          <Paint blendMode={"dstIn"} />
        </SkImage>
      </>
    );
  }

  // ── effect: grayscale ─────────────────────────────────────────────────────────
  if (effect === "grayscale") {
    return withRotation(
      <Group clip={circleClip}>
        <Group>
          <Paint>
            <ColorMatrix matrix={GRAYSCALE_MATRIX} />
          </Paint>
          {profileImage ? (
            <SkImage image={profileImage} x={ox} y={oy} width={ow} height={oh} fit="cover" />
          ) : placeholder}
        </Group>
      </Group>
    );
  }

  // ── effect: none → render ảnh gốc, KHÔNG clip tròn ─────────────────────────
  return withRotation(
    profileImage
      ? <SkImage image={profileImage} x={ox} y={oy} width={ow} height={oh} fit="cover" />
      : placeholder
  );
}

// ─── TextLayer ────────────────────────────────────────────────────────────────

function TextLayer({
  overlay,
  userName,
  variantIndex,
  scale,
  selectedAnswers,
  selectedOptions,
}: {
  overlay: TextOverlay;
  userName: string;
  variantIndex: number;
  scale: number;
  selectedAnswers?: Record<string, number>;
  selectedOptions?: Record<string, string>;
}) {
  const { x, y, w, h, c, f, ta, va, uc, sb, si, st, stcl, lw, hl, a } = overlay;

  // fs có thể undefined nếu JSON thiếu field → fallback 16
  const fs = typeof overlay.fs === "number" && overlay.fs > 0 ? overlay.fs : 16;
  // c có thể undefined → fallback đen
  const color  = c || "#000000";
  // f có thể undefined → fallback arial
  const rawFont = f || "arial";

  const rawText     = resolveText(overlay, userName, variantIndex, selectedAnswers, selectedOptions);
  const displayText = uc ? rawText.toUpperCase() : rawText;
  const fontFamily  = resolveFontFamily(rawFont);
  const scaledW     = w * scale;
  const scaledH     = h * scale;

  /**
   * Build a Skia paragraph with a given fontSize, return the paragraph + its rendered height.
   */
  function buildParagraph(targetFontSize: number) {
    /**
     * hl trong JSON luôn là line-height tuyệt đối tính bằng px (ở kích thước gốc).
     * Skia heightMultiplier = lineHeight / fontSize (ratio).
     *
     * Ví dụ:
     *   hl=2,  fs=30 → heightMultiplier = 2/30 = 0.067 → quá nhỏ → dùng default
     *   hl=30, fs=25 → heightMultiplier = 30/25 = 1.2   → hợp lý
     *   hl=4,  fs=30 → heightMultiplier = 4/30  = 0.13  → quá nhỏ → dùng default
     *   hl=60, fs=30 → heightMultiplier = 60/30 = 2.0   → hợp lý
     *
     * Nếu ratio < 1.0 (hl nhỏ hơn fs) thì hl không có nghĩa là px
     * mà có thể là số dòng tối đa → bỏ qua, dùng default 1.2
     */
    const lineHeightMultiplier = (() => {
      if (typeof hl !== "number" || hl <= 0) return 1.2;  // default
      const ratio = hl / fs;                               // hl px / fs px = ratio
      if (ratio < 1.0) return 1.2;                        // hl < fs → không hợp lệ → default
      return ratio;                                        // hl >= fs → dùng ratio
    })();

    const paraStyle = {
      textAlign: TA_MAP[ta],
      strutStyle: {
        strutEnabled:     true,
        forceStrutHeight: true,
        fontSize:         targetFontSize,
        heightMultiplier: lineHeightMultiplier,
      },
    };

    const builder = Skia.ParagraphBuilder.Make(paraStyle);

    const textStyle = {
      color:        Skia.Color(color),
      fontSize:     targetFontSize,
      fontFamilies: [fontFamily],
      fontStyle: {
        weight: sb ? FontWeight.Bold  : FontWeight.Normal,
        slant:  si ? FontSlant.Italic : FontSlant.Upright,
      },
      ...(st && stcl
        ? {
            shadows: [{
              color:      Skia.Color(stcl),
              blurRadius: (lw ?? 4) * scale,
              offset:     { x: 0, y: 0 },
            }],
          }
        : {}),
    };

    builder.pushStyle(textStyle);
    builder.addText(displayText);
    builder.pop();

    const para = builder.build();
    para.layout(scaledW);
    return para;
  }

  /**
   * Auto-fit: bắt đầu từ fontSize gốc, giảm dần 1px cho đến khi
   * text height vừa khít trong box scaledH. Dừng ở min 8px.
   */
  const paragraph = useMemo(() => {
    const initialFontSize = fs * scale;
    let fitFontSize = initialFontSize;
    let para = buildParagraph(fitFontSize);

    // Nếu text không tràn thì dùng luôn, không cần loop
    if (para.getHeight() <= scaledH) return para;

    // Binary search để tìm fontSize lớn nhất mà text vừa trong box
    let lo = 8;
    let hi = initialFontSize;

    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      const testPara = buildParagraph(mid);
      if (testPara.getHeight() <= scaledH) {
        lo = mid;
        para = testPara;
      } else {
        hi = mid;
      }
    }

    return para;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayText, color, fontFamily, fs, scale, sb, si, st, stcl, lw, ta, hl, scaledW, scaledH]);

  const paraH   = paragraph.getHeight();
  const scaledX = x * scale;
  const scaledY = y * scale;
  const scaledW2 = w * scale;

  const drawY =
    va === "middle" ? scaledY + (scaledH - paraH) / 2 :
    va === "bottom" ? scaledY + scaledH - paraH        :
                      scaledY;

  const hasRotation = typeof a === "number" && a !== 0;
  const centerX = scaledX + scaledW2 / 2;
  const centerY = scaledY + scaledH / 2;

  if (hasRotation) {
    const transform = [
      { translateX: centerX },
      { translateY: centerY },
      { rotate: (a! * Math.PI) / 180 },
      { translateX: -centerX },
      { translateY: -centerY },
    ];
    return (
      <Group transform={transform}>
        <Paragraph paragraph={paragraph} x={scaledX} y={drawY} width={scaledW} />
      </Group>
    );
  }

  return (
    <Paragraph paragraph={paragraph} x={scaledX} y={drawY} width={scaledW} />
  );
}

// ─── SingleResult ─────────────────────────────────────────────────────────────

function SingleResult({
  config,
  userName,
  profileUri,
  variantIndex,
  selectedAnswers,
  selectedOptions,
  externalCanvasRef,
}: {
  config: ResultConfig;
  userName: string;
  profileUri: string;
  variantIndex: number;
  selectedAnswers?: Record<string, number>;
  selectedOptions?: Record<string, string>;
  externalCanvasRef?: React.RefObject<any>;
}) {
  const internalRef = useRef<any>(null);
  const canvasRef = externalCanvasRef ?? internalRef;

  // Canvas render 1:1 theo JSON (tọa độ overlay không đổi)
  // View bọc ngoài dùng transform scale để fit chiều ngang màn hình
  const nativeW   = config.width;
  const nativeH   = config.height;
  const screenW   = Dimensions.get('window').width;
  const fitScale  = screenW / nativeW;          // scale để ngang card = ngang màn
  const displayW  = nativeW;                    // canvas luôn render ở native size
  const displayH  = nativeH;
  const scale     = 1;



  // Clip path = RoundedRect theo đúng kích thước background đã scale
  // Dùng Skia clip thay vì CSS borderRadius để không ảnh hưởng các overlay
  const CANVAS_BORDER_RADIUS = 5;
  const canvasClipPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.addRRect({
      rect: { x: 0, y: 0, width: displayW, height: displayH },
      rx: CANVAS_BORDER_RADIUS,
      ry: CANVAS_BORDER_RADIUS,
    });
    return p;
  }, [displayW, displayH]);

  return (
    // outerWrapper đặt kích thước thật trên màn (sau khi scale)
    // transform scale không thay đổi layout nên cần đặt width/height tường minh
    <View style={[styles.cardWrapper, {
      width:  nativeW * fitScale,
      height: nativeH * fitScale,
    }]}>
      <View style={{
        width:  nativeW,
        height: nativeH,
        transform: [{ scale: fitScale }],
        transformOrigin: 'top left',  // scale từ góc trên trái
      }}>
        <Canvas
          ref={canvasRef}
          style={[styles.canvas, { width: displayW, height: displayH }]}
        >
        <Fill color="white" />

        {/* Tất cả overlay bị clip trong bounds của background */}
        <Group clip={canvasClipPath}>
          {config.overlays.map((overlay, i) => {
            if (overlay.type === "background") {
              return (
                <BackgroundLayer
                  key={i}
                  overlay={overlay}
                  scale={scale}
                  variantIndex={variantIndex}
                  selectedAnswers={selectedAnswers}
                />
              );
            }
            if (overlay.type === "profile") {
              return (
                <ProfileLayer
                  key={i}
                  overlay={overlay}
                  profileUri={profileUri}
                  scale={scale}
                />
              );
            }
            if (overlay.type === "text") {
              return (
                <TextLayer
                  key={i}
                  overlay={overlay}
                  userName={userName}
                  variantIndex={variantIndex}
                  scale={scale}
                  selectedAnswers={selectedAnswers}
                  selectedOptions={selectedOptions}
                />
              );
            }
            return null;
          })}
        </Group>
        </Canvas>
      </View>
    </View>
  );
}

// ─── QuestionScreen (internal) ───────────────────────────────────────────────

const IMAGE_BASE_URL =
  "https://res.cloudinary.com/dr7qgoamh/image/upload/v1714101427/gametucthoi/static/images/";

function QuestionView({
  question,
  onAnswer,
}: {
  question: QuizQuestion;
  onAnswer: (varName: string, optionIndex: number) => void;
}) {
  const options = Object.entries(question.options);
  return (
    <ScrollView contentContainerStyle={styles.qContainer}>
      <Text style={styles.qAction}>{question.action}</Text>
      <View style={styles.qGrid}>
        {options.map(([key, opt], idx) => (
          <TouchableOpacity
            key={key}
            style={styles.qCard}
            onPress={() => onAnswer(question.var, idx)}
            activeOpacity={0.75}
          >
            {opt.src ? (
              <Image
                source={{ uri: `${IMAGE_BASE_URL}${opt.src}` }}
                style={styles.qImage}
                resizeMode="cover"
              />
            ) : null}
            {question.showText && (
              <Text style={styles.qTitle}>{opt.title}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── QuizResultCard (default export) ─────────────────────────────────────────

export default function QuizResultCard({
  userName,
  jsonData,
  profileUri   = "",
  variantIndex = 0,
  canvasRef,
}: QuizResultCardProps) {
  const questions = jsonData?.question ?? [];
  const results   = jsonData?.result   ?? [];

  // Nếu có question → bắt đầu từ màn hình câu hỏi
  // Nếu không        → thẳng vào result
  const [questionIdx, setQuestionIdx]           = useState(0);
  const [selectedAnswers, setSelectedAnswers]   = useState<Record<string, number>>({});
  const [showResult, setShowResult]             = useState(questions.length === 0);

  function handleAnswer(varName: string, optionIndex: number) {
    const newAnswers = { ...selectedAnswers, [varName]: optionIndex };
    setSelectedAnswers(newAnswers);

    if (questionIdx + 1 < questions.length) {
      setQuestionIdx(questionIdx + 1);
    } else {
      setShowResult(true);
    }
  }

  // Build selectedOptions: varName → title của option đã chọn
  const selectedOptions: Record<string, string> = {};
  for (const question of questions) {
    const varName   = question.var;
    const chosenIdx = selectedAnswers[varName];
    if (chosenIdx !== undefined) {
      const optionKey = Object.keys(question.options)[chosenIdx];
      if (optionKey) selectedOptions[varName] = question.options[optionKey].title;
    }
  }

  // ── Màn hình câu hỏi ────────────────────────────────────────────────────────
  if (!showResult && questions.length > 0) {
    return (
      <QuestionView
        question={questions[questionIdx]}
        onAnswer={handleAnswer}
      />
    );
  }

  // ── Màn hình kết quả ────────────────────────────────────────────────────────
  if (!results.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Không tìm thấy cấu hình result.</Text>
      </View>
    );
  }

  // Chọn đúng 1 result theo variantIndex % results.length
  const resultConfig = results[variantIndex % results.length];

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <SingleResult
        config={resultConfig}
        userName={userName}
        profileUri={profileUri}
        variantIndex={variantIndex}
        selectedAnswers={selectedAnswers}
        selectedOptions={selectedOptions}
        externalCanvasRef={canvasRef}
      />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    padding: 16,
    alignItems: "center",
    gap: 24,
  },
  cardWrapper: {
    width: "100%",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  canvas: {
    // borderRadius xử lý bằng Skia RoundedRect clip bên trong canvas
    // để không ảnh hưởng đến profile overlay ở góc
    overflow: "hidden",
  },
  saveBtn: {
    backgroundColor: "#e30000",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0.5,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyText: {
    color: "#888",
    fontSize: 14,
  },
  // ── Question screen styles ──────────────────────────────────────────────────
  qContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  qAction: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
    marginBottom: 16,
    textAlign: "center",
  },
  qGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  qCard: {
    width: "30%",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  qImage: {
    width: "100%",
    aspectRatio: 1,
  },
  qTitle: {
    padding: 6,
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
    textAlign: "center",
  },

});