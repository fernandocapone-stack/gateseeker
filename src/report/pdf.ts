import type { Finding, Report } from "../types.js";
import { sanitize } from "./text.js";

/**
 * Dependency-free PDF writer for a report, the file behind the page's
 * "Download PDF" button. It runs in the browser and in Node (no Node
 * imports), writes PDF 1.4 with the three standard fonts (no embedding) and
 * lays the report out as a plain document: verdict, counts per priority,
 * every finding with its evidence, errors and limitations.
 *
 * Every string from the report is untrusted. Each one goes through
 * `sanitize()` (control characters and newlines removed, length capped), is
 * mapped to WinAnsi (anything else becomes "?") and has `\`, `(` and `)`
 * escaped before it enters a content stream, so report content can only ever
 * be text: it cannot close a string, add operators or create links or
 * actions. Snippets were already redacted by the engine; nothing here adds
 * data the JSON report does not carry.
 */

export type PdfReport = Pick<Report, "gate" | "summary" | "analyses" | "patterns" | "findings" | "errors" | "limitations" | "sources" | "gateseekerVersion">;

export interface PdfMeta {
  /** What was analyzed, e.g. "owner/repo@abc1234". */
  subject: string;
  exportedAt: Date;
  /** Extra facts for the caption line, already in plain words (e.g. "312 files read"). */
  notes?: string[];
}

const PRIORITY_LABEL: Record<string, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, MEDIUM: 2, LOW: 3 };

// --- logo -----------------------------------------------------------------------

/*
 * The GateSeeker logotype, copied from ui-kit/src/logo.tsx (the PO's Figma
 * export); tests/pdf.test.ts fails if the two drift apart. Drawn as vector
 * paths: symbol in the brand colour, wordmark in ink, 110 x 22 units with
 * the same offsets as the <Logo> component.
 */
export const LOGO_SYMBOL = "M20.9521 14.0332C20.9521 14.7072 20.6124 15.3355 20.0488 15.7051L11.5732 21.2637C10.9074 21.7003 10.0458 21.7001 9.37988 21.2637L5.30762 18.5928L20.9521 8.02148V14.0332ZM3.64648 17.5039L0.90332 15.7051C0.339765 15.3355 8.16603e-05 14.7072 0 14.0332V11.707L8.3916 11.5615L3.64648 17.5039ZM0 10.417V2C0 0.895431 0.895431 3.44887e-09 2 0H15.417L0 10.417ZM18.9521 0C20.0567 0 20.9521 0.895431 20.9521 2V7.01758L12.127 7.17188L17.8525 0H18.9521Z";
export const LOGO_WORDMARK = "M6 0.560547C6.53333 0.560547 7.05636 0.623954 7.56836 0.751953C8.09079 0.879919 8.58652 1.06136 9.05566 1.2959C9.525 1.53056 9.94104 1.81386 10.3037 2.14453L9.23242 3.44043C8.80576 3.0351 8.30354 2.72009 7.72754 2.49609C7.16233 2.26153 6.58653 2.14453 6 2.14453C5.42416 2.14453 4.89095 2.25065 4.40039 2.46387C3.90972 2.6772 3.47685 2.97042 3.10352 3.34375C2.73022 3.71706 2.43695 4.15496 2.22363 4.65625C2.02107 5.14678 1.91995 5.68005 1.91992 6.25586C1.91992 6.83181 2.021 7.37077 2.22363 7.87207C2.43693 8.37333 2.73026 8.81624 3.10352 9.2002C3.47685 9.57353 3.90972 9.86674 4.40039 10.0801C4.90152 10.2933 5.4399 10.4003 6.01562 10.4004C6.53824 10.4004 7.07722 10.2934 7.63184 10.0801C7.97327 9.95124 8.29316 9.79464 8.5918 9.61133V6.40039H10.2402V10.5283L9.94922 10.7383C9.6473 10.9422 9.31222 11.1279 8.94434 11.2959C8.46445 11.5198 7.96296 11.6962 7.44043 11.8242C6.91776 11.9416 6.3997 12 5.8877 12C5.05597 12 4.28282 11.8562 3.56836 11.5684C2.8644 11.2697 2.24027 10.8586 1.69629 10.3359C1.16296 9.81327 0.746909 9.20505 0.448242 8.51172C0.149632 7.80778 0 7.05578 0 6.25586C2.48015e-05 5.45596 0.149615 4.71482 0.448242 4.03223C0.757535 3.33898 1.18364 2.73063 1.72754 2.20801C2.27149 1.68539 2.90658 1.28018 3.63184 0.992188C4.36784 0.704187 5.15733 0.560547 6 0.560547ZM38.2354 0.52832C38.9607 0.52832 39.665 0.634322 40.3477 0.847656C41.0302 1.06094 41.6327 1.33846 42.1553 1.67969L41.3711 3.26367C40.9661 3.0079 40.5663 2.80551 40.1719 2.65625C39.7773 2.50695 39.4037 2.39994 39.0518 2.33594C38.6999 2.27196 38.3797 2.24026 38.0918 2.24023C37.5371 2.24023 37.0943 2.34721 36.7637 2.56055C36.4331 2.77388 36.2676 3.08298 36.2676 3.48828C36.2676 3.85086 36.3746 4.14917 36.5879 4.38379C36.8118 4.60773 37.0993 4.79503 37.4512 4.94434C37.8138 5.083 38.2091 5.21575 38.6357 5.34375C39.073 5.47174 39.505 5.61638 39.9316 5.77637C40.3582 5.92567 40.7527 6.12292 41.1152 6.36816C41.4779 6.6135 41.7662 6.9285 41.9795 7.3125C42.1927 7.68579 42.2998 8.16049 42.2998 8.73633C42.2998 9.39742 42.1183 9.97333 41.7559 10.4639C41.3933 10.9438 40.8918 11.3173 40.252 11.584C39.6226 11.8507 38.8965 11.9844 38.0752 11.9844C37.4886 11.9843 36.9179 11.9091 36.3633 11.7598C35.8088 11.5998 35.2864 11.3867 34.7959 11.1201C34.3159 10.8535 33.883 10.5444 33.499 10.1924L34.3154 8.63965C34.6994 8.9916 35.1046 9.29082 35.5312 9.53613C35.9686 9.78147 36.4064 9.9677 36.8438 10.0957C37.2917 10.2237 37.7128 10.2881 38.1074 10.2881C38.7687 10.2881 39.2809 10.1603 39.6436 9.9043C40.0169 9.6483 40.2031 9.2907 40.2031 8.83203C40.2031 8.45876 40.0911 8.16051 39.8672 7.93652C39.6539 7.70195 39.3664 7.50966 39.0039 7.36035C38.6519 7.21102 38.2567 7.07729 37.8193 6.95996C37.3928 6.84265 36.9607 6.70985 36.5234 6.56055C36.0968 6.40056 35.7025 6.20241 35.3398 5.96777C34.9878 5.73311 34.6996 5.429 34.4756 5.05566C34.2624 4.68237 34.1553 4.2077 34.1553 3.63184C34.1553 3.0026 34.3267 2.45861 34.668 2C35.0093 1.5308 35.4839 1.16806 36.0918 0.912109C36.7104 0.656192 37.4249 0.528336 38.2354 0.52832ZM15.6162 3.3125C16.7149 3.3125 17.5579 3.57897 18.1445 4.1123C18.7417 4.63496 19.046 5.36021 19.0566 6.28809L19.0723 11.8721H17.2646L17.2607 10.8486C17.0284 11.1323 16.7421 11.3619 16.4004 11.5361C15.8564 11.8135 15.2056 11.9521 14.4482 11.9521C13.8403 11.9521 13.3122 11.8343 12.8643 11.5996C12.4164 11.365 12.0695 11.0508 11.8242 10.6562C11.579 10.2511 11.4561 9.80298 11.4561 9.3125C11.4561 8.5445 11.7334 7.93035 12.2881 7.47168C12.8534 7.01301 13.6489 6.77824 14.6729 6.76758H17.249L17.248 6.48047C17.248 5.9258 17.0777 5.49293 16.7363 5.18359C16.3951 4.87447 15.8884 4.71979 15.2168 4.71973C14.8115 4.71973 14.3953 4.79506 13.9688 4.94434C13.5527 5.09367 13.1308 5.31161 12.7041 5.59961L11.9521 4.41602C12.3468 4.17068 12.7203 3.96762 13.0723 3.80762C13.4242 3.64764 13.7978 3.52576 14.1924 3.44043C14.5977 3.3551 15.0723 3.31251 15.6162 3.3125ZM22.0557 3.67969H24.5674V4.99219H22.0557V9.18359C22.0557 9.64203 22.1351 9.95721 22.2949 10.1279C22.4549 10.2879 22.6798 10.3682 22.9678 10.3682C23.1596 10.3681 23.357 10.3364 23.5596 10.2725C23.7728 10.2085 24.0019 10.1123 24.2471 9.98438L24.7109 11.3115C24.3803 11.5141 24.0394 11.6747 23.6875 11.792C23.3355 11.8987 22.9779 11.9521 22.6152 11.9521C22.1887 11.9521 21.7942 11.8718 21.4316 11.7119C21.0691 11.5413 20.7757 11.2746 20.5518 10.9121C20.3384 10.5494 20.2314 10.0799 20.2314 9.50391V1.36035H22.0557V3.67969ZM29.1816 3.3125C30.1841 3.31255 30.9897 3.5196 31.5977 3.93555C32.2056 4.34088 32.6376 4.91742 32.8936 5.66406C33.1495 6.4107 33.2397 7.29638 33.165 8.32031H26.7246C26.7802 8.61035 26.8678 8.87715 26.9893 9.12012C27.2239 9.56807 27.5439 9.91484 27.9492 10.1602C28.3652 10.4054 28.8398 10.5283 29.373 10.5283C30.3224 10.5283 31.1228 10.1915 31.7734 9.51953L32.749 10.4961C32.3331 10.9547 31.8267 11.3124 31.2295 11.5684C30.6322 11.8137 29.9654 11.9355 29.2295 11.9355C28.3548 11.9355 27.5921 11.7543 26.9414 11.3916C26.2908 11.0289 25.7836 10.5277 25.4209 9.8877C25.0584 9.23712 24.877 8.485 24.877 7.63184C24.877 6.77858 25.0583 6.03156 25.4209 5.3916C25.7836 4.74101 26.2908 4.23471 26.9414 3.87207C27.5921 3.50944 28.339 3.32317 29.1816 3.3125ZM47.2607 3.3125C48.2633 3.31252 49.0688 3.51962 49.6768 3.93555C50.2848 4.34088 50.7167 4.9174 50.9727 5.66406C51.2286 6.41072 51.3188 7.29634 51.2441 8.32031H44.8047C44.8603 8.61029 44.9469 8.87719 45.0684 9.12012C45.303 9.56806 45.6231 9.91483 46.0283 10.1602C46.4442 10.4054 46.919 10.5282 47.4521 10.5283C48.4015 10.5283 49.2019 10.1915 49.8525 9.51953L50.8291 10.4961C50.4131 10.9548 49.9059 11.3124 49.3086 11.5684C48.7113 11.8137 48.0445 11.9355 47.3086 11.9355C46.4339 11.9355 45.6712 11.7543 45.0205 11.3916C44.37 11.0289 43.8636 10.5276 43.501 9.8877C43.1383 9.23705 42.957 8.48513 42.957 7.63184C42.9571 6.77858 43.1383 6.03156 43.501 5.3916C43.8636 4.7412 44.3701 4.23465 45.0205 3.87207C45.6712 3.5094 46.4181 3.32317 47.2607 3.3125ZM56.0273 3.3125C57.0298 3.31256 57.8355 3.51961 58.4434 3.93555C59.0513 4.34088 59.4833 4.91745 59.7393 5.66406C59.9952 6.4107 60.0854 7.29639 60.0107 8.32031H53.5703C53.6259 8.61034 53.7135 8.87715 53.835 9.12012C54.0696 9.56806 54.3896 9.91484 54.7949 10.1602C55.2109 10.4054 55.6855 10.5283 56.2188 10.5283C57.1681 10.5283 57.9685 10.1915 58.6191 9.51953L59.5947 10.4961C59.1788 10.9547 58.6724 11.3124 58.0752 11.5684C57.4779 11.8137 56.8111 11.9355 56.0752 11.9355C55.2005 11.9355 54.4378 11.7543 53.7871 11.3916C53.1364 11.0289 52.6293 10.5277 52.2666 9.8877C51.9041 9.23711 51.7227 8.48501 51.7227 7.63184C51.7227 6.77858 51.904 6.03156 52.2666 5.3916C52.6293 4.74103 53.1365 4.2347 53.7871 3.87207C54.4377 3.50946 55.1847 3.32317 56.0273 3.3125ZM73.2627 3.3125C74.2652 3.31253 75.0708 3.5196 75.6787 3.93555C76.2867 4.34088 76.7186 4.9174 76.9746 5.66406C77.2306 6.41071 77.3208 7.29635 77.2461 8.32031H70.8057C70.8613 8.61036 70.9488 8.87714 71.0703 9.12012C71.305 9.56808 71.625 9.91483 72.0303 10.1602C72.4462 10.4054 72.9209 10.5283 73.4541 10.5283C74.4034 10.5283 75.2038 10.1915 75.8545 9.51953L76.8301 10.4961C76.4141 10.9546 75.9078 11.3124 75.3105 11.5684C74.7132 11.8137 74.0465 11.9355 73.3105 11.9355C72.4359 11.9355 71.6731 11.7543 71.0225 11.3916C70.3719 11.0289 69.8656 10.5276 69.5029 9.8877C69.1403 9.23704 68.958 8.48515 68.958 7.63184C68.958 6.77858 69.1403 6.03156 69.5029 5.3916C69.8656 4.74119 70.372 4.23464 71.0225 3.87207C71.6731 3.5094 72.42 3.32317 73.2627 3.3125ZM63.209 7.27441L66.9688 3.37598H69.0811L65.9189 6.65527L69.3213 11.8721H67.1455L64.6729 7.94727L63.209 9.4668V11.8721H61.3691V0H63.209V7.27441ZM83.4521 4.61328L80.3643 4.98047V11.8721H78.5244V3.37598H80.3643L82.4521 3.11328L83.4521 4.61328ZM14.9443 8.08008C14.3471 8.08008 13.9042 8.17027 13.6162 8.35156C13.3282 8.5329 13.1846 8.83205 13.1846 9.24805C13.1846 9.6427 13.3282 9.95772 13.6162 10.1924C13.9148 10.427 14.3202 10.5439 14.832 10.5439C15.2907 10.5439 15.7018 10.4637 16.0645 10.3037C16.427 10.1437 16.7154 9.93069 16.9287 9.66406C17.1154 9.42137 17.2244 9.15401 17.2559 8.8623L17.2529 8.08008H14.9443ZM29.1973 4.71973C28.6853 4.71973 28.2375 4.83763 27.8535 5.07227C27.4802 5.30693 27.187 5.63779 26.9736 6.06445C26.8298 6.34498 26.7353 6.65939 26.6885 7.00781H31.5654C31.5441 6.52794 31.4321 6.1226 31.2295 5.79199C31.0375 5.45066 30.7651 5.18915 30.4131 5.00781C30.0611 4.81589 29.6558 4.71973 29.1973 4.71973ZM47.2764 4.71973C46.7645 4.71977 46.3166 4.83764 45.9326 5.07227C45.5593 5.30693 45.266 5.63783 45.0527 6.06445C44.9089 6.34496 44.8144 6.65942 44.7676 7.00781H49.6445C49.6232 6.5279 49.5112 6.12261 49.3086 5.79199C49.1166 5.45067 48.8442 5.18914 48.4922 5.00781C48.1403 4.81597 47.7349 4.71973 47.2764 4.71973ZM56.043 4.71973C55.531 4.71973 55.0832 4.83765 54.6992 5.07227C54.3259 5.30693 54.0327 5.63779 53.8193 6.06445C53.6755 6.34498 53.581 6.65938 53.5342 7.00781H58.4111C58.3898 6.52796 58.2778 6.12259 58.0752 5.79199C57.8832 5.45066 57.6108 5.18915 57.2588 5.00781C56.9068 4.81588 56.5015 4.71974 56.043 4.71973ZM73.2783 4.71973C72.7664 4.71975 72.3185 4.83762 71.9346 5.07227C71.5613 5.30693 71.268 5.63781 71.0547 6.06445C70.9109 6.34497 70.8164 6.65941 70.7695 7.00781H75.6465C75.6251 6.52791 75.5132 6.12261 75.3105 5.79199C75.1185 5.45066 74.8461 5.18915 74.4941 5.00781C74.1422 4.81594 73.7368 4.71973 73.2783 4.71973Z";
const BRAND: [number, number, number] = [0.706, 0.471, 1]; // #b478ff, --gs-logo

/**
 * Converts the absolute SVG path commands the logo uses (M, L, H, V, C, Z)
 * into PDF path operators, scaled and flipped (SVG y grows downwards).
 * Any other command is a programming error: the input is our own constant.
 */
export function svgPathToPdf(d: string, scale: number, left: number, top: number): string {
  // Any letter is a command (an exponent "e" is consumed by the number pattern first).
  const tokens = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[A-Za-z]/g) ?? [];
  const ops: string[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  const n = (): number => Number(tokens[i++]);
  const pt = (px: number, py: number): string => `${num(left + px * scale)} ${num(top - py * scale)}`;
  while (i < tokens.length) {
    const t = tokens[i] ?? "";
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "Z") {
        ops.push("h");
        continue;
      }
    }
    if (cmd === "M") {
      x = n();
      y = n();
      ops.push(`${pt(x, y)} m`);
      cmd = "L"; // further pairs after M are line-tos
    } else if (cmd === "L") {
      x = n();
      y = n();
      ops.push(`${pt(x, y)} l`);
    } else if (cmd === "H") {
      x = n();
      ops.push(`${pt(x, y)} l`);
    } else if (cmd === "V") {
      y = n();
      ops.push(`${pt(x, y)} l`);
    } else if (cmd === "C") {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n();
      x = n();
      y = n();
      ops.push(`${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)} c`);
    } else {
      throw new Error(`unsupported SVG path command "${cmd}"`);
    }
  }
  return ops.join(" ");
}

// --- text encoding -------------------------------------------------------------

/* Unicode -> WinAnsi byte for the few characters outside Latin-1 that reports use. */
const WIN_ANSI_EXTRA: Record<number, number> = { 0x20ac: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97 };

/** Maps to WinAnsi bytes (as a latin1 string); unknown characters become "?". */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0x3f;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out += ch;
    else if (c === 0x2192) out += "->";
    else if (WIN_ANSI_EXTRA[c] !== undefined) out += String.fromCharCode(WIN_ANSI_EXTRA[c]);
    else out += "?";
  }
  return out;
}

function escapePdfString(winAnsi: string): string {
  return winAnsi.replace(/[\\()]/g, (m) => `\\${m}`);
}

// --- metrics ------------------------------------------------------------------

/* Glyph widths (1/1000 em) for codes 32..126 from the standard AFM files. */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

type FontKey = "F1" | "F2" | "F3";

function charWidth(font: FontKey, code: number): number {
  if (font === "F3") return 600;
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return table[code - 32] ?? 556;
  if (code === 0x85 || code === 0x97) return 1000;
  return 600; // Latin-1 letters and the rest: a safe upper bound for wrapping
}

function textWidth(font: FontKey, size: number, winAnsi: string): number {
  let w = 0;
  for (let i = 0; i < winAnsi.length; i++) w += charWidth(font, winAnsi.charCodeAt(i));
  return (w * size) / 1000;
}

/** Greedy word wrap; words longer than the line (URLs, paths) are split by character. */
function wrap(font: FontKey, size: number, winAnsi: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const push = () => {
    lines.push(current);
    current = "";
  };
  for (const word of winAnsi.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (textWidth(font, size, candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") push();
    let rest = word;
    while (textWidth(font, size, rest) > maxWidth) {
      let cut = 1;
      while (cut < rest.length && textWidth(font, size, rest.slice(0, cut + 1)) <= maxWidth) cut++;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current !== "" || lines.length === 0) push();
  return lines;
}

// --- layout -------------------------------------------------------------------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const BOTTOM = 60; // room for the footer
const CONTENT_W = PAGE_W - 2 * MARGIN;

type Rgb = [number, number, number];
const INK: Rgb = [0.1, 0.1, 0.12];
const MUTED: Rgb = [0.38, 0.4, 0.45];
const RED: Rgb = [0.75, 0.13, 0.13];
const AMBER: Rgb = [0.7, 0.45, 0.02];
const GREEN: Rgb = [0.1, 0.5, 0.25];
const RULE: Rgb = [0.82, 0.83, 0.86];

const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const rgb = (c: Rgb): string => `${num(c[0])} ${num(c[1])} ${num(c[2])} rg`;

interface TextOptions {
  font?: FontKey;
  size?: number;
  color?: Rgb;
  indent?: number;
  gapAfter?: number;
  /** Cap for sanitize(); report strings are cut here before layout. */
  max?: number;
}

class Layout {
  readonly pages: string[][] = [[]];
  private y = PAGE_H - MARGIN;

  private get ops(): string[] {
    return this.pages[this.pages.length - 1] ?? [];
  }

  private ensure(height: number): void {
    if (this.y - height >= BOTTOM) return;
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  text(raw: string, o: TextOptions = {}): void {
    const font = o.font ?? "F1";
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    const lead = size * 1.35;
    const lines = wrap(font, size, toWinAnsi(sanitize(raw, o.max ?? 2000)), CONTENT_W - indent);
    for (const l of lines) {
      this.ensure(lead);
      this.y -= lead;
      this.ops.push(`BT ${rgb(o.color ?? INK)} /${font} ${num(size)} Tf ${num(MARGIN + indent)} ${num(this.y + size * 0.3)} Td (${escapePdfString(l)}) Tj ET`);
    }
    this.y -= o.gapAfter ?? 0;
  }

  /** Several runs on one line (short labels only; no wrapping). */
  runs(parts: { text: string; font?: FontKey; size?: number; color?: Rgb }[], gapAfter = 0): void {
    const size = Math.max(...parts.map((p) => p.size ?? 10));
    const lead = size * 1.35;
    this.ensure(lead);
    this.y -= lead;
    let x = MARGIN;
    for (const p of parts) {
      const font = p.font ?? "F1";
      const s = p.size ?? 10;
      const t = toWinAnsi(sanitize(p.text, 120));
      this.ops.push(`BT ${rgb(p.color ?? INK)} /${font} ${num(s)} Tf ${num(x)} ${num(this.y + size * 0.3)} Td (${escapePdfString(t)}) Tj ET`);
      x += textWidth(font, s, t);
    }
    this.y -= gapAfter;
  }

  rule(gapBefore = 6, gapAfter = 8): void {
    this.ensure(gapBefore + gapAfter + 1);
    this.y -= gapBefore;
    this.ops.push(`${num(RULE[0])} ${num(RULE[1])} ${num(RULE[2])} RG 0.6 w ${num(MARGIN)} ${num(this.y)} m ${num(PAGE_W - MARGIN)} ${num(this.y)} l S`);
    this.y -= gapAfter;
  }

  /** The logotype, `height` points tall, at the left margin. */
  logo(height: number, gapAfter = 0): void {
    const scale = height / 22;
    this.ensure(height);
    const top = this.y;
    this.ops.push(`${rgb(BRAND)} ${svgPathToPdf(LOGO_SYMBOL, scale, MARGIN, top - 0.0045 * scale)} f`);
    this.ops.push(`${rgb(INK)} ${svgPathToPdf(LOGO_WORDMARK, scale, MARGIN + 26.95 * scale, top - 3.8 * scale)} f`);
    this.y -= height + gapAfter;
  }

  space(h: number): void {
    this.y -= h;
  }

  /** Keeps a block's first lines together with its heading. */
  keep(height: number): void {
    this.ensure(height);
  }
}

// --- report content -----------------------------------------------------------

function verdictWord(v: string): string {
  return v === "pass" ? "PASS" : v === "fail" ? "FAIL" : "INCOMPLETE";
}

function verdictColor(v: string): Rgb {
  return v === "pass" ? GREEN : v === "fail" ? RED : AMBER;
}

function kindLabel(f: Finding): string {
  return f.evidence.kind === "insecure-pattern" ? "code pattern" : f.evidence.kind === "supply-chain-anomaly" ? "supply chain" : "dependency";
}

function findingTitle(f: Finding): string {
  const e = f.evidence;
  if (e.kind === "insecure-pattern") return `${e.ruleId}: ${e.title}`;
  if (e.kind === "supply-chain-anomaly") return `${e.origin === "advisory" ? e.advisoryId ?? "" : e.ruleId ?? ""}: ${e.type}`;
  return `${e.vulnerabilityId}${e.aliases[0] ? ` (${e.aliases[0]})` : ""}: ${e.summary ?? ""}`;
}

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function ordered(findings: Finding[]): Finding[] {
  const sev = (f: Finding) => SEVERITY_RANK[f.severity.tier.toUpperCase()] ?? 9;
  return [...findings].sort((a, b) => a.priority.localeCompare(b.priority) || sev(a) - sev(b));
}

function writeFinding(doc: Layout, f: Finding): void {
  const e = f.evidence;
  doc.keep(70);
  doc.rule(4, 2);
  doc.runs([
    { text: `${f.priority} · ${PRIORITY_LABEL[f.priority] ?? ""}`, font: "F2", size: 9, color: f.priority === "P1" ? RED : f.priority === "P2" ? AMBER : MUTED },
    { text: `   ${f.severity.tier} · ${kindLabel(f)} · ${f.source.name}`, size: 9, color: MUTED },
  ]);
  doc.text(findingTitle(f), { font: "F2", size: 10.5, max: 300 });
  doc.text(f.subject, { font: "F3", size: 8.5, color: MUTED, max: 300 });
  doc.text(f.remediation.action, { size: 9.5, max: 600, gapAfter: 2 });

  if (e.kind === "insecure-pattern") {
    doc.text(`${e.file}:${String(e.line)} · classified as ${e.fileClass}`, { font: "F3", size: 8.5, color: MUTED, max: 300 });
    doc.text(e.snippet, { font: "F3", size: 8.5, indent: 8, max: 600 });
    doc.text(e.message, { size: 9.5, max: 800 });
  } else if (e.kind === "supply-chain-anomaly") {
    doc.text(e.summary, { size: 9.5, max: 800 });
    for (const i of e.indicators.slice(0, 12)) doc.text(`• ${i}`, { font: "F3", size: 8.5, indent: 8, max: 300 });
    doc.text(`Verification: ${e.verification}${e.reviewedBy ? ` · reviewed by ${e.reviewedBy}` : ""}`, { size: 9, color: MUTED, max: 300 });
  } else {
    if (e.details) doc.text(e.details.length > 1200 ? `${e.details.slice(0, 1200)}…` : e.details, { size: 9, color: MUTED, max: 1300 });
    const fixed = f.remediation.fixedVersions.length > 0 ? `fixed in ${f.remediation.fixedVersions.join(", ")}` : "no fixed version published";
    doc.text(`Published ${e.published ?? "unknown"} · source ${f.source.name} · ${fixed}`, { size: 9, color: MUTED, max: 400 });
  }
  doc.text(`Why this priority: ${f.rationale.join(" -> ")}`, { size: 8.5, color: MUTED, max: 600 });
  for (const r of f.references.slice(0, 6)) {
    const url = safeUrl(r.url);
    doc.text(url ? `${r.type}: ${url}` : r.type, { size: 8.5, color: MUTED, max: 400 });
  }
  doc.space(4);
}

function layoutReport(report: PdfReport, meta: PdfMeta): Layout {
  const doc = new Layout();
  const v = report.gate.verdict;

  doc.logo(22, 8);
  doc.runs([{ text: "Report ", font: "F2", size: 12 }, { text: meta.subject, font: "F3", size: 10, color: MUTED }]);
  doc.text(`Exported ${meta.exportedAt.toISOString().replace("T", " ").slice(0, 16)} UTC · Gateseeker ${report.gateseekerVersion}`, { size: 8.5, color: MUTED, gapAfter: 4 });
  doc.rule(2, 6);

  doc.runs([{ text: verdictWord(v), font: "F2", size: 14, color: verdictColor(v) }], 2);
  doc.text(report.gate.reason, { size: 10, max: 800, gapAfter: 2 });
  const s = report.summary;
  doc.text(
    report.analyses.dependencies === "analyzed"
      ? `Queried ${String(s.queried)} dependency version(s): ${String(s.byQueryState.vulnerable)} with known issues, ${String(s.byQueryState["no-known-vulnerabilities"])} without, ${String(s.byQueryState["query-failed"])} failed, ${String(s.byQueryState["not-queried"])} not queried.`
      : "Dependencies were not analyzed: no supported lockfile at the repository root.",
    { size: 9, color: MUTED },
  );
  if (report.analyses.patterns === "analyzed" && report.patterns) doc.text(`${String(report.patterns.filesScanned)} file(s) scanned for code patterns.`, { size: 9, color: MUTED });
  const g = report.gate;
  doc.text([`Gate: fail on ${g.failOn}, patterns ${g.patternsMode}, supply-chain rules ${g.supplyChainMode}`, ...(meta.notes ?? []), `sources: ${report.sources.map((x) => x.name).join(", ") || "none"}`].join(" · "), { size: 8.5, color: MUTED, max: 800, gapAfter: 6 });

  doc.runs(
    (["P1", "P2", "P3", "P4"] as const).map((p) => ({ text: `${p} ${PRIORITY_LABEL[p] ?? ""}: ${String(s.byPriority[p])}     `, font: "F2" as const, size: 9.5, color: p === "P1" && s.byPriority[p] > 0 ? RED : INK })),
    4,
  );

  doc.text(`Findings (${String(report.findings.length)})`, { font: "F2", size: 12, gapAfter: 2 });
  if (report.findings.length === 0) doc.text("No known vulnerabilities or insecure patterns were found in the sources consulted.", { size: 10 });
  for (const f of ordered(report.findings)) writeFinding(doc, f);

  if (report.errors.length > 0) {
    doc.keep(40);
    doc.text(`Errors and warnings (${String(report.errors.length)})`, { font: "F2", size: 11, gapAfter: 2 });
    for (const e of report.errors) doc.text(`• ${e}`, { size: 9, color: MUTED, indent: 6, max: 600 });
    doc.space(6);
  }
  doc.keep(40);
  doc.text("Limitations", { font: "F2", size: 11, gapAfter: 2 });
  for (const l of report.limitations) doc.text(`• ${l}`, { size: 9, color: MUTED, indent: 6, max: 600 });
  doc.space(8);
  doc.text('"No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.', { size: 8.5, color: MUTED });
  return doc;
}

// --- file ---------------------------------------------------------------------

/** Renders the report as a PDF file. Deterministic for the same input and `exportedAt`. */
export function renderPdf(report: PdfReport, meta: PdfMeta): Uint8Array<ArrayBuffer> {
  const doc = layoutReport(report, meta);
  const total = doc.pages.length;
  const footer = toWinAnsi(sanitize(meta.subject, 120));

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(""); // filled once the pages object id is known
  const pagesId = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  doc.pages.forEach((ops, i) => {
    const foot = [
      `BT ${rgb(MUTED)} /F1 8 Tf ${num(MARGIN)} 32 Td (${escapePdfString(footer)}) Tj ET`,
      `BT ${rgb(MUTED)} /F1 8 Tf ${num(PAGE_W - MARGIN - 60)} 32 Td (Page ${String(i + 1)} of ${String(total)}) Tj ET`,
    ];
    const stream = [...ops, ...foot].join("\n");
    const content = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${String(pagesId)} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 ${String(f1)} 0 R /F2 ${String(f2)} 0 R /F3 ${String(f3)} 0 R >> >> /Contents ${String(content)} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${String(pagesId)} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(" ")}] /Count ${String(kids.length)} >>`;
  const info = add(`<< /Title (${escapePdfString(toWinAnsi(sanitize(`Gateseeker report ${meta.subject}`, 200)))}) /Producer (Gateseeker ${escapePdfString(toWinAnsi(sanitize(report.gateseekerVersion, 40)))}) >>`);

  // Every character is below 256, so string length equals byte length for the xref offsets.
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R /Info ${String(info)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
