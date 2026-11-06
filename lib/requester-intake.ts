export type RequestIntakeQuestion = {
  key: string;
  question: string;
  options: string[];
};

export type RequestIntakeAnswer = {
  request_id: string;
  question_key: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  source: "request_help" | "ai_assistant";
  updated_at: string;
};

export function normalizeSpokenIntakeAnswer(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function isRequestIntakeSkipCurrent(transcript: string, localizedLabel = "") {
  const spoken = normalizeSpokenIntakeAnswer(transcript);
  return [
    "skip",
    "skip this",
    "skip it",
    "skip question",
    "skip this question",
    "skip this one",
    "next",
    "next question",
    "pass",
    "pass this question",
    localizedLabel,
  ].some((phrase) => normalizeSpokenIntakeAnswer(phrase) === spoken);
}

export function isRequestIntakeSkipRemaining(transcript: string, localizedLabel = "") {
  const spoken = normalizeSpokenIntakeAnswer(transcript);
  return [
    "skip remaining",
    "skip remaining questions",
    "skip the remaining questions",
    "skip all",
    "skip all questions",
    "skip these questions",
    "skip the rest",
    "skip the rest of the questions",
    localizedLabel,
  ].some((phrase) => normalizeSpokenIntakeAnswer(phrase) === spoken);
}

export function isRequestIntakeCannotAnswer(transcript: string) {
  const spoken = normalizeSpokenIntakeAnswer(transcript);
  return [
    "cannot answer now",
    "can not answer now",
    "i cannot answer now",
    "i can not answer now",
    "cant answer now",
    "can't answer now",
    "i cant answer now",
    "i can't answer now",
    "not able to answer now",
    "unable to answer now",
    "i dont know right now",
    "i don't know right now",
  ].some((phrase) => normalizeSpokenIntakeAnswer(phrase) === spoken);
}

export function matchRequestIntakeOption(
  spokenAnswer: string,
  options: string[],
  displayOption: (option: string) => string = (option) => option,
) {
  const spoken = normalizeSpokenIntakeAnswer(spokenAnswer);
  if (!spoken) return null;
  const numberedChoice = spoken.match(/^(?:(?:please )?(?:select|choose|pick|click|press) )?(?:(?:button|option|choice|number) )?(one|two|three|four|1|2|3|4)$/)
    ?? spoken.match(/^(first|second|third|fourth) (?:button|choice|option)$/);
  if (numberedChoice) {
    const position = ({ one: 1, two: 2, three: 3, four: 4, 1: 1, 2: 2, 3: 3, 4: 4, first: 1, second: 2, third: 3, fourth: 4 } as const)[numberedChoice[1] as "one" | "two" | "three" | "four" | "1" | "2" | "3" | "4" | "first" | "second" | "third" | "fourth"];
    return options[position - 1] ?? null;
  }
  const paddedSpoken = ` ${spoken} `;
  const aliasesFor = (option: string) => {
    const canonical = normalizeSpokenIntakeAnswer(option);
    if (canonical.startsWith("yes")) return ["yes", "yeah", "yep", "yebo", "ewe", "ja", "correct", "affirmative"];
    if (canonical === "no" || canonical.startsWith("not currently")) return ["no", "nope", "hayi", "nee", "nnyaa", "che", "not happening"];
    if (canonical.includes("not sure")) return ["not sure", "unsure", "i do not know", "i don't know", "dont know"];
    if (canonical === "one person") return ["one", "just one", "single person"];
    if (canonical === "two people") return ["two", "just two"];
    if (canonical === "three or more") return ["three", "more than two", "multiple people"];
    if (canonical === "a building") return ["building", "house"];
    if (canonical === "a vehicle") return ["vehicle", "car"];
    if (canonical === "personal safety") return ["personal security", "someone following me", "feeling unsafe"];
    if (canonical === "fire / smoke") return ["fire", "smoke", "burning", "flames"];
    if (canonical === "medical emergency") return ["medical", "medical help", "medical emergency"];
    if (canonical === "outside materials") return ["outside", "outdoor materials"];
    if (canonical === "crime in progress") return ["crime", "crime happening now"];
    if (canonical === "suspicious activity") return ["suspicious"];
    return [];
  };
  const candidates = options.map((option) => ({
    option,
    labels: [normalizeSpokenIntakeAnswer(displayOption(option)), normalizeSpokenIntakeAnswer(option), ...aliasesFor(option).map(normalizeSpokenIntakeAnswer)].filter(Boolean),
  })).sort((left, right) => Math.max(...right.labels.map((label) => label.length)) - Math.max(...left.labels.map((label) => label.length)));

  const exactMatch = candidates.find(({ labels }) => labels.some((label) => paddedSpoken.includes(` ${label} `)));
  if (exactMatch) return exactMatch.option;

  // Speech recognition commonly mishears a word in a longer option phrase.
  // Keep short answers exact, then use a conservative edit-distance match.
  const distance = (left: string, right: string) => {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const above = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1]));
        diagonal = above;
      }
    }
    return row[right.length];
  };
  const closest = candidates.map((candidate) => {
    const score = Math.max(0, ...candidate.labels.filter((label) => label.length >= 7).map((label) => {
      const words = spoken.split(" ");
      const phraseWords = label.split(" ");
      let best = 0;
      for (let start = 0; start <= words.length - phraseWords.length; start += 1) {
        const phrase = words.slice(start, start + phraseWords.length).join(" ");
        best = Math.max(best, 1 - distance(phrase, label) / Math.max(phrase.length, label.length));
      }
      return best;
    }));
    return { option: candidate.option, score };
  }).sort((left, right) => right.score - left.score);
  return closest[0]?.score >= 0.78 ? closest[0].option : null;
}

const MEDICAL_QUESTIONS: RequestIntakeQuestion[] = [
  { key: "medical_trapped", question: "Is anyone trapped or unable to move?", options: ["Yes", "No", "I am not sure"] },
  { key: "medical_breathing", question: "Is anyone unconscious or not breathing normally?", options: ["Yes", "No", "I am not sure"] },
  { key: "medical_danger", question: "Is there heavy bleeding or another immediate danger?", options: ["Yes", "No", "I am not sure"] },
  { key: "medical_people", question: "How many people need help?", options: ["One person", "Two people", "Three or more", "I am not sure"] },
  { key: "medical_other", question: "Is there anything else responders should know right away?", options: ["Yes", "No", "I am not sure"] },
];

const FIRE_QUESTIONS: RequestIntakeQuestion[] = [
  { key: "fire_trapped", question: "Is anyone trapped or unable to leave?", options: ["Yes", "No", "I am not sure"] },
  { key: "fire_spreading", question: "Is the fire spreading or producing heavy smoke?", options: ["Yes", "No", "I am not sure"] },
  { key: "fire_safety", question: "Is it safe for you to stay where you are?", options: ["Yes", "No", "I am not sure"] },
  { key: "fire_type", question: "What is burning?", options: ["A building", "A vehicle", "Outside materials", "I am not sure"] },
];

const POLICE_QUESTIONS: RequestIntakeQuestion[] = [
  { key: "police_situation", question: "What kind of situation is this?", options: ["Crime in progress", "Suspicious activity", "Personal safety", "Other"] },
  { key: "police_happening", question: "Is it happening right now?", options: ["Yes, right now", "Just happened", "Not currently", "I am not sure"] },
  { key: "police_danger", question: "Is anyone in immediate danger?", options: ["Yes", "No", "I am not sure"] },
];

const GENERAL_QUESTIONS: RequestIntakeQuestion[] = [
  { key: "general_danger", question: "Is anyone in immediate danger right now?", options: ["Yes", "No", "I am not sure"] },
  { key: "general_happening", question: "Is the situation still happening?", options: ["Yes, right now", "Just happened", "I am not sure"] },
  { key: "general_people", question: "How many people are affected?", options: ["One person", "Two people", "Three or more", "I am not sure"] },
  { key: "general_safety", question: "Is it safe for you to stay where you are?", options: ["Yes", "No", "I am not sure"] },
];

export function questionsForEmergency(category: string, note = ""): RequestIntakeQuestion[] {
  const normalized = `${category} ${note}`.toLowerCase();
  if (/police|crime|robbery|suspicious|personal safety/.test(normalized)) return POLICE_QUESTIONS;
  if (/fire|smoke|burning/.test(normalized)) return FIRE_QUESTIONS;
  if (/medical|injur|trauma|breath|accident|unconscious/.test(normalized)) return MEDICAL_QUESTIONS;
  return GENERAL_QUESTIONS;
}
