import { z } from "zod";
import { NextResponse } from "next/server";

import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { formatAssistantAnswer } from "@/lib/format-assistant-answer";
import { REQUESTER_LANGUAGES, requesterAiLanguage } from "@/lib/requester-language";
import { knowledgeDigest, matchTopic } from "@/lib/assistant/knowledge-base";

export const runtime = "nodejs";

const LIVE_AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    allowed: { type: "boolean" },
    answer: { type: "string" },
  },
  required: ["allowed", "answer"],
  additionalProperties: false,
};

const MODEL_GROUNDED_REQUESTER_TOPIC_IDS = new Set([
  "assistant.about",
  "safety.numbers",
  "safety.waiting",
  "status.meanings",
  "voice.input",
  "voice.trouble",
  "account.register",
  "account.signin",
  "requester.request",
  "requester.share-details",
  "requester.location",
  "requester.track",
  "requester.cancel",
  "requester.history",
  "requester.notifications",
  "requester.profile",
]);

const requestSchema = z.object({
  emergency: z.object({
    id: z.string().min(1), category: z.string().min(1).max(120), severity: z.string().min(1).max(40), note: z.string().max(2000).nullish().transform((value) => value ?? ""), status: z.string().max(40).nullish().transform((value) => value ?? ""),
    location: z.object({
      address: z.string().max(300).nullish().transform((value) => value ?? "Location unavailable"),
      lat: z.number().finite().nullish(),
      lng: z.number().finite().nullish(),
    }),
  }),
  question: z.string().trim().min(1).max(500),
  language: z.enum(REQUESTER_LANGUAGES).optional().default("English"),
  messages: z.array(z.object({ role: z.enum(["assistant", "user"]), text: z.string().max(2000) })).max(20).optional(),
  answers: z.array(z.object({ question: z.string().max(500), answer: z.string().max(200) })).max(20).optional(),
});

const OFF_SCOPE_INTENT = /\b(python|javascript|typescript|programming|coding|write\s+code|code\s+for|script|homework|schoolwork|essay|politics|stock|crypto|trivia|video\s+game|gaming)\b/i;
const GREETING = /\b(hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening)|howdy|hallo|goeie\s+(?:môre|more|middag|aand)|goeiemôre|hoe\s+gaan\s+dit|molo|molweni|sawubona|sanibonani|unjani|ninjani|lumela|lumelang|dumela|dumela\s+(?:mma|rra)|o\s+tsogile\s+jang)\b/i;
const LIVE_REQUEST_TERMS = /\b(live\s+(?:request|app|service|ai|assistant|map|tracking|voice|language|settings|history|notifications?|account|profile|support)|what\s+(?:is|does)\s+LIVE|how\s+does\s+LIVE\s+work|this\s+app|the\s+app|emergency(?:\s+(?:request|response|team|contact|number|line|services?))?|response\s+team|responder\s+team|dispatch\s+team|responders?|dispatch(?:er|ers|ing)?|driver|ambulance|response\s+vehicle|danger|safety|safe|help|call|contact|location|address|map|track(?:ing)?|eta|estimated\s+(?:arrival|time)|where|status(?:es)?|status\s+meaning|meaning\s+of\s+(?:the\s+)?status(?:es)?|request\s+(?:help|assistance|status|history|update|details?|cancellation)|create\s+(?:an?\s+)?(?:emergency\s+)?request|active\s+request|duplicate\s+request|my\s+request|this\s+request|my\s+emergency|this\s+emergency|assigned|assignment|en[- ]?route|arriv(?:al|ed)|waiting|what\s+happens\s+next|submit(?:ted)?|receiv(?:ed)|cancel(?:led|ed|lation)?|closed?|completed?|rejected?|notification|history|update|priority|severity|critical|moderate|fire|smoke|police|crime|robbery|personal\s+safety|suspicious\s+activity|shots\s+fired|rescue|medical\s+emergency|severe\s+injury|unconscious|breathing\s+issues|vehicle\s+accident|account\s+settings|profile\s+settings|profile\s+details|edit\s+(?:my\s+)?profile|update\s+(?:my\s+)?profile|change\s+(?:my\s+)?profile|my\s+(?:live\s+)?(?:account|profile|password|emergency\s+contact|medical\s+details)|change\s+(?:my\s+)?password|forgot\s+password|reset\s+password|delete\s+(?:my\s+)?account|logout|log\s+out|password|verification\s+code|email\s+verification|sign\s+in|log\s+in|register|registration|terms\s+and\s+conditions|privacy|data\s+protection|security|dark\s+mode|light\s+mode|appearance|theme|reduce\s+motion|screen\s+brightness|text\s+size|text\s+spacing|voice\s+guidance|voice\s+commands?|voice\s+navigation|blind\s+voice\s+guidance|notification\s+sound|microphone|language|answer\s+in|respond\s+in|translation|accessibility|cost|payment|fee|billing|subscription|offline|internet\s+connection|service\s+area|coverage|operating\s+hours|support\s+hours|ai\s+assistant|ai\s+language\s+support|live\s+supported\s+languages?|live\s+voice\s+navigation|live\s+accessibility\s+settings)\b/i;
const HEALTH_TERMS: RegExp[] = [
  /\b(health|healthy|healthcare|medical|medicine|wellness|self[- ]?care|first[- ]?aid|treat(?:ment|ing)?|care|prevent(?:ion)?|recover(?:y|ing)?)\b/i,
  /\b(symptom|signs?|diagnos(?:is|e|ed|tic)|condition|disease|disorder|illness|sick|unwell|infection|contagious|chronic|acute|flare[- ]?up)\b/i,
  /\b(pain|ache|sore|fever|temperature|headache|migraine|dizz(?:y|iness)|lightheaded|nausea|vomit(?:ing)?|diarrh(?:ea|oea)|constipat(?:ion|ed)|cramp(?:s|ing)?|fatigue|tired|weakness|numb(?:ness)?|tingl(?:e|ing)|swelling|inflamm(?:ation|ed)|rash|itch(?:y|ing)|hiv(?:es)?)\b/i,
  /\b(breath(?:e|ing|lessness)?|shortness\s+of\s+breath|cough|wheez(?:e|ing)|asthma|chok(?:e|ing)|airway|oxygen|unconscious|unresponsive|faint(?:ed|ing)?|black(?:ed)?\s+out|seiz(?:ure|ing)|convulsion|stroke|heart\s+attack|cardiac|chest\s+pain|palpitation)\b/i,
  /\b(bleed(?:ing)?|haemorrhag\w*|hemorrhag\w*|wound|cut|scrape|abrasion|bruise|burn|scald|fractur\w*|broken\s+bone|sprain\w*|strain\w*|dislocat\w*|injur\w*|trauma|accident|crash|collision|fall|head\s+injury|concussion|nosebleed|bite|sting|electric\s+shock|electrocut\w*|drown\w*|near[- ]?drown\w*)\b/i,
  /\b(allerg\w*|anaphyl\w*|poison\w*|overdos\w*|toxic|chemical\s+(?:exposure|burn|splash)|smoke\s+inhalation|heatstroke|heat\s+exhaustion|hypothermia|dehydration|shock|diabet\w*|asthma|epilep\w*|cancer|tumou?r|arthritis|blood\s+pressure|hypertension|cholesterol|kidney|liver|thyroid|ulcer|reflux|ibs|uti|urinary|kidney\s+stone)\b/i,
  /\b(heart|chest|lung|brain|head|neck|face|eye|vision|ear|hearing|nose|throat|mouth|tooth|teeth|jaw|skin|hair|nail|blood|bone|joint|muscle|nerve|spine|back|abdomen|abdominal|stomach|belly|pelvis|hip|arm|elbow|wrist|hand|finger|leg|knee|ankle|foot|feet|toe|kidney|liver|stool|urine|urination)\b/i,
  /\b(medicat\w*|prescri\w*|drug\s+interaction|side\s+effects?|dos(?:e|age)|pill|tablet|capsule|antibiotic|painkiller|analgesic|ibuprofen|paracetamol|acetaminophen|aspirin|insulin|inhaler|vaccine|vaccin\w*|immuni[sz]\w*|supplement|vitamin|herb(?:al)?|over[- ]the[- ]counter|otc)\b/i,
  /\b(blood\s+test|lab\s+result|test\s+result|medical\s+test|screening|x[- ]?ray|mri|ct\s+scan|ultrasound|biopsy|ecg|ekg|vital\s+signs?|pulse|heart\s+rate|oxygen\s+level|blood\s+sugar|glucose|cholesterol\s+level)\b/i,
  /\b(mental\s+health|anxiety|panic|depress\w*|stress|trauma|ptsd|grief|suicid\w*|self[- ]?harm|eating\s+disorder|insomnia|sleep|addiction|substance\s+use|alcohol|withdrawal)\b/i,
  /\b(pregnan\w*|obstetric\w*|birth|labor|labour|miscarriage|contracepti\w*|birth\s+control|fertility|menstrual|period|menopause|vaginal|penile|sexual\s+health|sti\b|std\b|sexually\s+transmitted)\b/i,
  /\b(baby|babies|infant|child|children|kid|teenager|adolescent|elderly|older\s+adult|newborn|pediatric|paediatric|breastfeed\w*|developmental\s+milestone)\b/i,
  /\b(diet|nutrition|food\s+safety|exercise|fitness|weight|obesity|hydration|sleep\s+health|hygiene|posture|rehabilitation|physical\s+therapy|physiotherapy|surgery|operation|hospital|clinic|doctor|nurse|pharmacist|dentist|therapist|specialist|urgent\s+care|emergency\s+room|poison\s+control|first\s+responder)\b/i,
  // Cardiovascular, blood, and circulation terms.
  /\b(arrhythmia|dysrhythmia|atrial\s+fibrillation|a[- ]?fib|heart\s+failure|angina|coronary|cardiomyopath\w*|aneurysm|blood\s+clot|thromb\w*|deep\s+vein\s+thrombosis|\bdvt\b|pulmonary\s+embol\w*|varicose\s+vein|circulation|circulatory|anemia|anaemia|iron\s+deficien\w*|sickle\s+cell|hemophilia|haemophilia|white\s+blood\s+cell|red\s+blood\s+cell|platelet|blood\s+count|blood\s+clotting)\b/i,
  // Respiratory, infectious, and immune conditions.
  /\b(copd|emphysema|bronchitis|pneumonia|tuberculosis|\btb\b|whooping\s+cough|pertussis|rsv|covid(?:[- ]?19)?|coronavirus|influenza|flu|common\s+cold|cold\s+symptoms|sinusitis|sinus\s+infection|sleep\s+apnea|sleep\s+apnoea|snoring|phlegm|mucus|sputum|autoimmune|lupus|multiple\s+sclerosis|\bms\b|rheumatoid\s+arthritis|psoriatic\s+arthritis|immune\s+system|immunocompromis\w*|sepsis|septic|cellulitis|mrsa|hepatitis|shingles|chickenpox|measles|mumps|rubella|malaria|dengue|lyme\s+disease|hpv|herpes|syphilis|gonorrh\w*|chlamydia|chicken\s+pox)\b/i,
  // Neurology, senses, and developmental health.
  /\b(parkinson\w*|alzheimer\w*|dementia|epilep\w*|neuropath\w*|multiple\s+sclerosis|als|motor\s+neurone?\s+disease|bell'?s\s+palsy|vertigo|tinnitus|ringing\s+in\s+(?:the\s+)?ears?|hearing\s+loss|earache|ear\s+infection|conjunctivitis|pink\s+eye|glaucoma|cataract\w*|macular\s+degeneration|retinal|detached\s+retina|blurred\s+vision|double\s+vision|color\s+blindness|colour\s+blindness|adhd|autis\w*|dyslexia|developmental\s+disorder|memory\s+loss|confusion|brain\s+fog|tremor|shak(?:e|ing)|coordination|balance\s+problem)\b/i,
  // Digestive, liver, gallbladder, and bowel health.
  /\b(gerd|gastro[- ]?oesophageal|gastro[- ]?esophageal|acid\s+reflux|heartburn|indigestion|ibs|irritable\s+bowel|ibd|inflammatory\s+bowel|crohn\w*|ulcerative\s+colitis|celiac|coeliac|gluten\s+intoleran\w*|gallbladder|gallstone\w*|pancreatitis|cirrhosis|fatty\s+liver|liver\s+disease|jaundice|hepatitis|hemorrhoid\w*|haemorrhoid\w*|bloating|flatulence|gas\s+pain|bowel\s+movement|stomach\s+bug|food\s+poisoning|appendicitis|hernia|difficulty\s+swallowing|swallowing\s+problem)\b/i,
  // Hormonal, metabolic, bone, and joint conditions.
  /\b(hypothyroid\w*|hyperthyroid\w*|hashimoto\w*|graves'?\s+disease|polycystic\s+ovary|\bpcos\b|insulin\s+resistan\w*|prediabet\w*|gestational\s+diabet\w*|hypoglyc\w*|hyperglyc\w*|low\s+blood\s+sugar|high\s+blood\s+sugar|osteoporos\w*|osteopenia|osteoarthritis|rheumat\w*|gout|fibromyalgia|sciatica|scoliosis|tendonitis|tendinitis|bursitis|carpal\s+tunnel|disc\s+slip|slipped\s+disc|herniated\s+disc|meniscus|ligament|cartilage|bone\s+density|adrenal|cortisol|hormone\w*)\b/i,
  // Skin, hair, nails, mouth, and dental conditions.
  /\b(eczema|dermatitis|psoriasis|acne|rosacea|melanoma|skin\s+cancer|skin\s+lesion|mole|hives|urticaria|cold\s+sore|canker\s+sore|blister|wart|fungal\s+infection|ringworm|athlete'?s\s+foot|scabies|lice|hair\s+loss|alopecia|ingrown\s+nail|nail\s+fungus|gum\s+disease|gingivitis|periodontitis|toothache|cavity|dental\s+abscess|wisdom\s+tooth|oral\s+health|mouth\s+ulcer|dry\s+mouth|bad\s+breath)\b/i,
  // Urinary, reproductive, pregnancy, and sexual health.
  /\b(cystitis|bladder\s+infection|kidney\s+disease|chronic\s+kidney|renal|kidney\s+failure|kidney\s+stone|bladder\s+stone|incontinence|urinary\s+incontinence|painful\s+urination|burning\s+when\s+(?:i\s+)?pee|blood\s+in\s+(?:the\s+)?urine|prostat\w*|erectile\s+dysfunction|impotence|testicular\s+pain|testicular\s+torsion|ovarian\s+cyst|uterine\s+fibroid|endometriosis|pelvic\s+inflammatory\s+disease|\bpid\b|pelvic\s+pain|hot\s+flush|hot\s+flash|prenatal|antenatal|postpartum|postnatal|labour|labor|contraction|water\s+broke|morning\s+sickness|breast\s+lump|mastitis|lactation|breastfeeding|menstrual\s+cramp|vaginal\s+discharge|erection|libido|sexual\s+function|sexual\s+violence)\b/i,
  // Mental, behavioural, and substance-related health.
  /\b(bipolar|schizophren\w*|obsessive[- ]compulsive|\bocd\b|attention[- ]deficit|adhd|panic\s+attack|phobia|psychosis|psychotic|hallucination|delusion|mood\s+disorder|personality\s+disorder|borderline\s+personality|autism|neurodivergen\w*|eating\s+disorder|anorexia|bulimia|binge\s+eating|body\s+image|burnout|suicid\w*|self[- ]?harm|substance\s+misuse|drug\s+misuse|overeat\w*|smoking|tobacco|nicotine|vaping|cannabis|opioid|benzodiazepine|alcohol\s+use|sobriety|relapse|counsel\w*|psychotherap\w*|cognitive\s+behavio\w*)\b/i,
  // Common symptoms, care, investigations, and procedures.
  /\b(chills?|shiver\w*|sweat(?:ing|s)?|night\s+sweats?|loss\s+of\s+appetite|poor\s+appetite|appetite|weight\s+gain|weight\s+loss|hair\s+thinning|hoarse(?:ness)?|voice\s+change|difficulty\s+breathing|difficulty\s+swallowing|dry\s+eyes|watery\s+eyes|light\s+sensitivity|discharge|pus|phlegm|bruising\s+easily|swollen\s+glands?|lymph\s+nodes?|lymph\s+node|lump|mass|lesion|screening|mammogram|pap\s+smear|colonoscopy|endoscopy|gastroscopy|electrocardiogram|echocardiogram|stress\s+test|spirometry|urinalysis|culture\s+test|pathology|radiology|chemotherapy|radiotherapy|radiation\s+therapy|dialysis|transplant|stitches|sutures|cast|splint|crutch\w*|prosthe\w*|hearing\s+aid|cpap|defibrillator|aed)\b/i,
];

function isHealthRelated(text: string) {
  return HEALTH_TERMS.some((pattern) => pattern.test(text));
}

function isInScope(question: string, context: string) {
  if (OFF_SCOPE_INTENT.test(question)) return false;
  if (GREETING.test(question)) return true;
  if (isHealthRelated(question) || LIVE_REQUEST_TERMS.test(question)) return true;
  return isFollowUp(question) && (isHealthRelated(context) || LIVE_REQUEST_TERMS.test(context));
}

function topicFor(text: string) {
  const topics: Array<[string, RegExp]> = [
    ["cpr", /\bcpr\b|\bcpf\b|cardiopulmonary|resuscitat/i],
    ["burn", /\bburn\w*\b|\bscald\w*\b/i],
    ["bleeding", /\bbleed\w*\b|\bhemorrhag\w*\b/i],
    ["wound", /\bwound\w*\b|\bcut\w*\b|\bscrape\w*\b/i],
    ["choking", /\bchok\w*\b|\bairway\b/i],
    ["breathing", /\bbreath\w*\b|\bunconscious\b|\bunresponsive\b|\bnot waking\b/i],
    ["allergy", /\ballerg\w*\b|\banaphyl\w*\b/i],
    ["poisoning", /\bpoison\w*\b|\boverdose\b/i],
    ["seizure", /\bseiz\w*\b|\bconvulsion\w*\b/i],
    ["fever", /\bfever\b|\btemperature\b/i],
    ["medication", /\bmedicin\w*\b|\bmedication\w*\b|\bdrug\b|\bdosage\b|\bdose\b/i],
  ];
  return topics.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function isFollowUp(text: string) {
  return /\b(after|before|then|it|that|this|they|them|those|there|why|how long|how much|what about|what next|what now|can i still|does it|will it)\b/i.test(text);
}

function relevantHistory(messages: Array<{ role: "assistant" | "user"; text: string }>, question: string) {
  if (!isFollowUp(question)) return [];

  const history = messages.at(-1)?.role === "user" && messages.at(-1)?.text.trim() === question.trim()
    ? messages.slice(0, -1)
    : messages;
  const questionTopic = topicFor(question);

  for (let index = history.length - 1; index > 0; index -= 1) {
    const answer = history[index];
    const priorQuestion = history[index - 1];
    if (answer.role !== "assistant" || priorQuestion.role !== "user" || !answer.text.trim()) continue;
    if (questionTopic && topicFor(priorQuestion.text) !== questionTopic) continue;
    return [priorQuestion, answer];
  }

  return [];
}

function partialJsonStringField(source: string, field: string) {
  const key = source.indexOf(`"${field}"`);
  if (key < 0) return "";
  const colon = source.indexOf(":", key + field.length + 2);
  const openingQuote = colon < 0 ? -1 : source.indexOf('"', colon + 1);
  if (openingQuote < 0) return "";

  let value = "";
  for (let index = openingQuote + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return value;
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = source[index + 1];
    if (escaped === undefined) break;
    if (escaped === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (hex.length !== 4) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const escapeMap: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    value += escapeMap[escaped] ?? escaped;
    index += 1;
  }
  return value;
}

function splitFinishedTranslationSegments(source: string, flush = false) {
  const segments: string[] = [];
  const ending = /\r?\n+|[.!?](?:["')\]]*)\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = ending.exec(source))) {
    const punctuationBoundary = !match[0].includes("\n");
    if (punctuationBoundary) {
      const lineStart = source.lastIndexOf("\n", match.index) + 1;
      const textBeforePunctuation = source.slice(lineStart, match.index + 1).trimEnd();
      const currentToken = textBeforePunctuation.split(/\s+/).at(-1) ?? "";
      // Keep ordered-list markers such as "1. " attached to the following step.
      if (/^\d+[.)]$/.test(currentToken)) continue;
    }
    const end = ending.lastIndex;
    segments.push(source.slice(start, end));
    start = end;
  }
  const rest = source.slice(start);
  if (flush && rest) segments.push(rest);
  return { segments, rest: flush ? "" : rest };
}

async function translateAiSegment(text: string, language: string) {
  return translateText(text, "English", language);
}

async function translateText(text: string, sourceLanguage: string, targetLanguage: string) {
  const baseUrl = (process.env.LIVE_TRANSLATION_BASE_URL || "http://127.0.0.1:9931").replace(/\/$/, "");
  const model = process.env.LIVE_TRANSLATION_MODEL || "qvac/TranslatePsy-AfriSLM-0.8B-Q4-GGUF:Q4_K_M";
  const marker = text.match(/^\s*(?:\d+[.)]|[-*•])\s+/)?.[0] ?? text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const content = text.slice(marker.length, text.length - trailing.length).trim();
  if (!content) return text;
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `You are a professional ${sourceLanguage} to ${targetLanguage} translator. Accurately convey the meaning and nuances of the original text while preserving names, numbers, and safety instructions. Produce only the ${targetLanguage} translation, with no explanations or commentary.` },
        { role: "user", content: `Please translate the following ${sourceLanguage} text into ${targetLanguage}: ${content}\n\nTranslation:` },
      ],
      temperature: 0,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Translation model returned HTTP ${response.status}.${detail ? ` ${detail}` : ""}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const translated = payload.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error("The translation model returned an empty answer.");
  return marker + translated + trailing;
}

function typedAnswerResponse(answer: string, provider: string, model: string) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        if (!cancelled) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for (const text of answer.match(/\S+\s*/g) ?? [answer]) {
          if (cancelled) return;
          send("delta", { text });
          await new Promise((resolve) => setTimeout(resolve, 18));
        }
        if (!cancelled) {
          send("final", { answer, provider, model });
          controller.close();
        }
      } catch {
        // The user may stop reading while a fallback answer is being typed.
      }
    },
    cancel() { cancelled = true; },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = createHandler(
  { name: "live.ai", auth: "required", roles: ["requester", "responder", "dispatcher", "admin", "auditor", "manager", "support"], body: requestSchema, rateLimit: { limit: 30, windowMs: 60_000, by: "user" } },
  async (ctx) => {
    const { question, messages = [] } = ctx.body;
    // Only requester chats can supply incident context. Staff use the same
    // assistant UI for general LIVE help and must not inject request details.
    const emergency = ctx.user.role === "requester"
      ? ctx.body.emergency
      : { id: "general", category: "General assistance", severity: "High", note: "", status: "", location: { address: "Location unavailable" } };
    const answers = ctx.user.role === "requester" ? ctx.body.answers ?? [] : [];
    // Unsupported translator targets use English for AI answers only. The
    // requester's selected UI language and emergency-intake translations remain unchanged.
    const language = requesterAiLanguage(ctx.body.language);
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b-instruct";
    const englishQuestion = language === "English"
      ? question
      : await translateText(question, language, "English");
    const knownTopic = matchTopic(englishQuestion, "requester");
    const matchedTopic = !OFF_SCOPE_INTENT.test(englishQuestion)
      && knownTopic
      && MODEL_GROUNDED_REQUESTER_TOPIC_IDS.has(knownTopic.topic.id)
      ? knownTopic
      : null;
    const useKnowledgeFallback = async () => {
      if (!matchedTopic) return null;
      const answer = language === "English"
        ? matchedTopic.topic.answer
        : await translateText(matchedTopic.topic.answer, "English", language);
      return typedAnswerResponse(
        formatAssistantAnswer(answer, question),
        language === "English" ? "LIVE knowledge base fallback" : "LIVE AI",
        matchedTopic.topic.id,
      );
    };
    const priorTurn = await Promise.all(relevantHistory(messages, englishQuestion).map(async (message) => ({
      role: message.role,
      content: language === "English"
        ? message.text.slice(-1200)
        : await translateText(message.text.slice(-1200), language, "English"),
    })));
    const recentAnswers = answers.slice(-8);
    const scopeContext = [
      emergency.category,
      emergency.note,
      ...priorTurn.map((message) => message.content),
      ...answers.flatMap((item) => [item.question, item.answer]),
    ].join(" ");
    const likelyInScope = Boolean(matchedTopic) || isInScope(englishQuestion, scopeContext);

    const systemPrompt = [
      "You are LIVE AI, a shared emergency, health, first-aid, safety, and LIVE product-support assistant for requesters and response staff. Answer the latest user message only. The signed-in actor may be a requester, responder, dispatcher, admin, auditor, manager, or support user; do not assume which role they have unless their question says so.",
      "Allowed topics include greetings; health and first-aid questions; immediate safety; and questions directly about the LIVE service, account/workspace, emergency requests, or authorised response workflow. This includes request categories and forms, location, contact and medical details, intake answers, dispatch/assignment, responders, calls, tracking/maps/ETA, request statuses, waiting and safety guidance, cancellations, notifications, history, profile/password/account access, language/AI support, voice commands, accessibility, appearance and settings, and Terms and Conditions. Explain staff and requester workflows at a general level. Treat product-support questions as in scope even without medical terms. Do not claim access to private staff dashboards or operational records unless the current request context explicitly supplies them. Refuse unrelated general knowledge, entertainment, coding, politics, finance, and topics outside health, safety, emergency response, and LIVE.",
      "Verified LIVE request setup: requesters select a service/category and a priority (Critical, High, or Moderate), describe what happened, confirm a device location or enter an address, and submit. Medical categories include Medical emergency, Severe Injury / Trauma, Unconscious / Breathing Issues, Vehicle Accident, and Other Medical Emergency. Police categories include Armed Robbery, House Robbery, Crime in Progress / Shots Fired, Personal safety, Suspicious Activity, and Other Police Emergency. Fire categories include Fire / smoke, Building fire, Vehicle fire, Rescue from fire, and Other Fire Emergency. The callback number comes from the requester profile; optional category-specific emergency questions can be answered or skipped. An active request should be opened and tracked instead of submitting a duplicate.",
      "For questions about information to share, suggest concise, relevant facts such as the exact location and access instructions, what happened, how many people need help, immediate hazards, a callback number, and relevant medical details if applicable. Do not ask for unnecessary sensitive information.",
      "For questions about waiting or what happens next, give calm, general LIVE workflow guidance: keep the phone reachable, share important changes, stay in a safe place if possible, and follow instructions from dispatch or responders. If there is immediate danger, tell the user to contact local emergency services. Never promise that dispatch has received or assigned the request unless its supplied status says so; never invent an assigned responder, arrival time, ETA, or live update. Explain only what the supplied request context supports, and say when LIVE does not provide the detail asked for.",
      "Explain the supplied request status in plain language. LIVE statuses can include submitted (stored, not yet confirmed by dispatch), received (dispatch confirmed and is reviewing), assigned (a responder has been assigned), en_route (the responder is travelling), arrived (the responder reached the location), closed (completed and closed), cancelled (no responder is coming), or rejected (not accepted; contact the local emergency line directly). Do not imply that help is on the way for submitted, received, cancelled, or rejected requests; do not describe a possible future step as a current fact.",
      "Dispatchers review and coordinate requests and assign responders; responders handle assigned missions and update progress such as en_route and arrived. Explain these roles generally, but never assert that a particular dispatcher or responder has taken an action unless the supplied request context confirms it.",
      "For requester questions about using LIVE, explain the relevant feature at a general level: create a request, provide or confirm location, answer optional emergency questions, check status updates and notifications, view request history, follow map tracking when available, and use the in-app controls to contact dispatch or an assigned responder when shown. The Call dispatch control requires an active request and can offer dispatchers for that request area; the call flow may try up to three available dispatchers, for up to 15 seconds each. If nobody answers, LIVE reports that no dispatcher is available; it does not mean an emergency service has been contacted. LIVE AI cannot place calls, change a request, or verify dispatcher/responder availability. Never claim you completed an app action; point the user to the relevant LIVE control, and explain that available actions depend on the current request status.",
      "If a requester asks to cancel: when there is no active responder assignment, the request can be cancelled immediately. When a responder is assigned, the requester submits a cancellation request for dispatcher approval and must wait for the status update. Do not claim the request was cancelled until its supplied status is cancelled. If the user still needs urgent help, direct them to local emergency services.",
      "The requester workspace provides Home, Request help, History, Notifications, profile, and settings. The request form uses device location when available and lets the requester confirm or enter an address; if location access is unavailable, guide them to the on-screen location/address controls. A map can show the request location and assigned responder route when live data is available. State an ETA or responder position only if supplied in the current context or visible in the user's described screen.",
      "Requester voice navigation can move among Home, Request help, History, Notifications, Profile, Settings, tracking, and LIVE AI, and can include call-driver, undo, or cancel commands. Voice guidance can speak status/ETA/distance updates, and blind voice guidance can read unread notifications. These features depend on the user's settings, browser, and microphone/speech support; do not assume they are enabled.",
      "Requester profile/settings let users update their name and phone, emergency contact, and optional medical conditions, allergies, and medications; the email address cannot be changed in the profile editor. Changing a password from Profile requires an email verification code first; Forgot password sends a reset link. LIVE also provides registration/email verification and sign-in. Never ask the user to reveal a password or verification code. Requesters can choose light/dark appearance, an interface language, and voice navigation/guidance preferences. The accessibility control includes brightness, text size, expanded text spacing, reduced motion, and notification sound/volume settings. These are app features; do not claim to change them for the user.",
      "LIVE AI provides a new-chat control and chat history for conversations associated with an emergency request. Do not claim that AI chat can see all of a user's past requests or access private staff dashboards.",
      "LIVE's Terms say it helps share emergency information with authorised response teams, does not replace official emergency numbers, and does not guarantee emergency services have been contacted. Contact, emergency-contact, location, and optional medical information supplied by the user may be used to support a request and shared with authorised response teams. Users should keep account/contact details accurate and secure and provide only accurate, relevant information. Do not invent data-retention, privacy, security, fees, availability/coverage, or legal-policy details beyond the visible Terms; direct users to the Terms and Conditions screen for the full wording.",
      "The requester interface offers English, Afrikaans, isiZulu, isiXhosa, Sesotho, Setswana, Sepedi, siSwati, Tshivenda, isiNdebele, and XiTsonga. LIVE AI answer translation currently supports only English, Afrikaans, isiZulu, isiXhosa, Sesotho, and Setswana; for the other interface languages AI answers use English. Never claim support for another AI answer language. AI can make mistakes or mistranslate; it is not a substitute for qualified medical care.",
      matchedTopic
        ? `Matched curated LIVE reference (authoritative product facts; answer in your own clear wording without adding unsupported details):\n${JSON.stringify({ title: matchedTopic.topic.title, answer: matchedTopic.topic.answer })}`
        : `Curated LIVE requester help reference (use for product details when relevant):\n${knowledgeDigest("requester")}`,
      "Always compose the final reply from the user's question and the supplied LIVE references. When a matched topic is supplied, preserve its steps and safety limits while making the answer direct and easy to follow.",
      "If asked about account-specific data, the current dispatcher/responder, a live position or ETA, call availability, exact policy, or a feature not described here, use only the supplied context and say when you cannot verify it. Do not guess or expose another user's private information; direct the user to the relevant LIVE screen or authorised response team.",
      "Examples of in-scope LIVE questions include: 'What details should I share with the response team?', 'What should I expect while waiting for help?', and 'Can you explain the status of my request?' Answer these directly using the provided context and the guidance above.",
      "General health information and ordinary first-aid guidance are explicitly allowed. Never refuse a health question only because it asks about symptoms, an injury, or basic treatment. Give practical, cautious steps and explain warning signs that need urgent care; do not diagnose or claim every injury is an emergency.",
      "A message that is only a greeting in any supported language (such as hi, hello, hallo, molo, sawubona, lumela, or dumela) is in scope. Reply with a brief friendly greeting and ask what the user needs. Do not refuse a greeting or request emergency details unless they ask about the emergency.",
      "Give safe, practical guidance in plain language. Do not diagnose. For immediate danger, tell the user to call local emergency services now. Do not guess a country's emergency number; use one only when the user's location makes it reliable, otherwise tell them to use their local official emergency number.",
      `The model response language is English. Answer in English; LIVE will translate the answer to ${language} when translation is supported. If translation leaves the user's question unclear, ask a brief clarification instead of guessing.`,
      "Use clean Markdown. For procedures, use a numbered list with one complete action per number. Never put a number on a line by itself, never prefix every sentence with a bullet, and never escape a period after a step number.",
      "For CPR, keep the person lying flat on a firm surface. Never place them on their side or raise their head for chest compressions. Tell the user to call emergency services, use speakerphone, start hard and fast chest compressions in the centre of the chest, and use an AED as soon as available. If the patient is a child or infant, clearly say CPR differs by age and follow dispatcher guidance; do not give adult-only instructions as though they fit every child.",
      "If prior turns are provided, use them only to resolve a clear follow-up. Ignore them when the user asks a new or different topic. Never reuse an earlier answer as the answer to a new question.",
      "Return one JSON object only with exactly these fields: allowed (boolean), answer (string).",
      `Scope check for the latest message: ${likelyInScope ? "possible in-scope topic" : "outside scope"}. If outside scope, set allowed=false and briefly refuse. If marked possible in-scope, still check the user's actual intent: a shared word such as help, status, call, or language does not make an unrelated question in scope. Answer only if it is genuinely about health, safety, emergency response, or a LIVE feature; otherwise set allowed=false and briefly refuse.`,
      `LIVE request context: ${JSON.stringify({ category: emergency.category, severity: emergency.severity, status: emergency.status, note: emergency.note, location: emergency.location.address })}`,
      `User-provided emergency details: ${JSON.stringify(recentAnswers)}`,
    ].join("\n");

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...priorTurn,
            { role: "user", content: englishQuestion },
          ],
          stream: true,
          format: LIVE_AI_RESPONSE_SCHEMA,
          keep_alive: "10m",
          options: { temperature: matchedTopic ? 0 : 0.2, top_p: 0.8, num_ctx: 4096, num_predict: 400 },
        }),
      });
    } catch (error) {
      ctx.log.error("requester_ai_model_failed", {
        provider: "ollama",
        model,
        cause: error instanceof Error ? error.message : String(error),
      });
      const fallback = await useKnowledgeFallback();
      if (fallback) return fallback;
      throw new ApiError(
        "UPSTREAM_FAILED",
        `LIVE AI could not reach ${model} at ${baseUrl}. Start Ollama, confirm the model is installed, and try again. No fallback answer was used.`,
        { internal: error instanceof Error ? error.message : String(error) },
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      ctx.log.error("requester_ai_model_http_error", { provider: "ollama", model, status: response.status, detail });
      const fallback = await useKnowledgeFallback();
      if (fallback) return fallback;
      throw new ApiError(
        "UPSTREAM_FAILED",
        `Ollama returned HTTP ${response.status} for ${model}.${detail ? ` ${detail}` : ""} No fallback answer was used.`,
        { internal: detail },
      );
    }

    if (!response.body) {
      const fallback = await useKnowledgeFallback();
      if (fallback) return fallback;
      throw new ApiError("UPSTREAM_FAILED", `Ollama returned no stream for ${model}. No fallback answer was used.`);
    }

    const encoder = new TextEncoder();
    const eventStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const sendTypedAnswer = async (answer: string) => {
          for (const word of answer.match(/\S+\s*/g) ?? [answer]) {
            send("delta", { text: word });
            await new Promise((resolve) => setTimeout(resolve, 18));
          }
        };
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let modelJson = "";
        let sentAnswer = "";
        let observedAnswer = "";
        let translationBuffer = "";
        let translatedAnswer = "";
        let translationStatusSent = false;
        let translationFailure: Error | null = null;
        let translationQueue = Promise.resolve();
        const queueTranslationSegments = (segments: string[]) => {
          for (const segment of segments) {
            translationQueue = translationQueue.then(async () => {
              if (translationFailure) return;
              if (!translationStatusSent) {
                send("status", { type: "translating", language });
                translationStatusSent = true;
              }
              try {
                const translated = await translateAiSegment(segment, language);
                translatedAnswer += translated;
                const words = translated.match(/\S+\s*/g) ?? [translated];
                for (const word of words) {
                  send("delta", { text: word });
                  await new Promise((resolve) => setTimeout(resolve, 18));
                }
              } catch (error) {
                translationFailure = error instanceof Error ? error : new Error("Translation could not finish.");
              }
            });
          }
        };

        try {
          let finished = false;
          while (!finished) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              const ollamaChunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
              if (ollamaChunk.error) throw new Error(ollamaChunk.error);
              modelJson += ollamaChunk.message?.content ?? "";
              const answerSoFar = partialJsonStringField(modelJson, "answer");
              if (!matchedTopic && language === "English" && answerSoFar.length > sentAnswer.length) {
                send("delta", { text: answerSoFar.slice(sentAnswer.length) });
                sentAnswer = answerSoFar;
              } else if (!matchedTopic && language !== "English" && answerSoFar.length > observedAnswer.length) {
                translationBuffer += answerSoFar.slice(observedAnswer.length);
                observedAnswer = answerSoFar;
                const completed = splitFinishedTranslationSegments(translationBuffer);
                translationBuffer = completed.rest;
                queueTranslationSegments(completed.segments);
              }
              finished = Boolean(ollamaChunk.done) || chunk.done;
            }
            if (chunk.done) {
              if (buffer.trim()) {
                const finalChunk = JSON.parse(buffer) as { message?: { content?: string }; done?: boolean; error?: string };
                if (finalChunk.error) throw new Error(finalChunk.error);
                modelJson += finalChunk.message?.content ?? "";
              }
              finished = true;
            }
          }

          let modelResult: { allowed?: boolean; answer?: string };
          try {
            modelResult = JSON.parse(modelJson) as { allowed?: boolean; answer?: string };
          } catch {
            throw new Error(`${model} returned an invalid structured response. No answer was saved; check the model output and try again.`);
          }
          if (typeof modelResult.allowed !== "boolean" || typeof modelResult.answer !== "string" || !modelResult.answer.trim()) {
            throw new Error(`${model} did not return a valid LIVE answer.`);
          }
          if (!matchedTopic && language !== "English" && modelResult.answer.length > observedAnswer.length) {
            translationBuffer += modelResult.answer.slice(observedAnswer.length);
            observedAnswer = modelResult.answer;
          }
          // The local health-domain check is authoritative for routing. Small
          // models often set `allowed` to false for valid health questions; the
          // answer is still model-generated and the refusal check below rejects
          // an actual refusal. For off-topic prompts, never accept an answer the
          // model marked as allowed.
          if (!likelyInScope && modelResult.allowed) {
            ctx.log.warn("requester_ai_model_scope_mismatch", { provider: "ollama", model, inScope: likelyInScope });
            throw new Error(`${model} did not follow LIVE's scope instructions. No answer was saved.`);
          }
          const modelRefused = /(?:can't|cannot|unable to)\s+(?:assist|help|provide|give|offer)|(?:can't|cannot)\s+(?:provide|give|offer)\s+(?:medical|health|first[- ]aid)\s+(?:advice|information|treatment)/i.test(modelResult.answer);
          let answerToDeliver = modelResult.answer;
          let usedKnowledgeFallback = false;
          if (likelyInScope && matchedTopic && (!modelResult.allowed || modelRefused)) {
            answerToDeliver = matchedTopic.topic.answer;
            usedKnowledgeFallback = true;
          } else if (likelyInScope && modelRefused) {
            ctx.log.warn("requester_ai_model_nonanswer", { provider: "ollama", model, inScope: true });
            throw new Error(`${model} refused this in-scope health question. No answer was saved; check the Ollama model and try again.`);
          }

          let finalAnswer: string;
          if (matchedTopic) {
            const englishAnswer = answerToDeliver;
            const localizedAnswer = language === "English"
              ? englishAnswer
              : await translateText(englishAnswer, "English", language);
            finalAnswer = formatAssistantAnswer(localizedAnswer, question);
            await sendTypedAnswer(finalAnswer);
          } else if (language === "English") {
            finalAnswer = formatAssistantAnswer(answerToDeliver, question);
          } else {
            const completed = splitFinishedTranslationSegments(translationBuffer, true);
            translationBuffer = "";
            queueTranslationSegments(completed.segments);
            await translationQueue;
            if (translationFailure) throw translationFailure;
            if (!translatedAnswer.trim()) throw new Error("The translation model returned an empty answer.");
            finalAnswer = formatAssistantAnswer(translatedAnswer, question);
          }
          send("final", {
            answer: finalAnswer,
            provider: usedKnowledgeFallback ? language === "English" ? "LIVE knowledge base fallback" : "LIVE AI" : language === "English" ? "ollama" : "LIVE AI",
            model: usedKnowledgeFallback ? matchedTopic?.topic.id ?? model : language === "English" ? model : `${model} + TranslatePsy`,
          });
        } catch (error) {
          ctx.log.error("requester_ai_stream_failed", { provider: "ollama", model, cause: error instanceof Error ? error.message : String(error) });
          if (matchedTopic && likelyInScope) {
            try {
              const englishAnswer = matchedTopic.topic.answer;
              const localizedAnswer = language === "English" ? englishAnswer : await translateText(englishAnswer, "English", language);
              const fallbackAnswer = formatAssistantAnswer(localizedAnswer, question);
              await sendTypedAnswer(fallbackAnswer);
              send("final", { answer: fallbackAnswer, provider: language === "English" ? "LIVE knowledge base fallback" : "LIVE AI", model: matchedTopic.topic.id });
            } catch (fallbackError) {
              send("error", { message: fallbackError instanceof Error ? fallbackError.message : "LIVE AI could not finish its answer." });
            }
          } else {
            send("error", { message: error instanceof Error ? error.message : "LIVE AI could not finish its answer." });
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new NextResponse(eventStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);
