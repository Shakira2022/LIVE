"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleHelp, History, Mic, Phone, Plus, Send, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readCached, readFreshCache, writeFreshCache } from "@/lib/client-cache";
import { authenticatedFetch } from "@/lib/client-api";
import { formatAssistantAnswer } from "@/lib/format-assistant-answer";
import { isRequestIntakeSkipCurrent, isRequestIntakeSkipRemaining, matchRequestIntakeOption, normalizeSpokenIntakeAnswer, questionsForEmergency } from "@/lib/requester-intake";
import { useRequestIntakeAnswers } from "@/lib/use-request-intake-answers";
import { useCall } from "@/components/calls/call-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { readRequesterLanguage, requesterAiLanguage, type RequesterLanguage } from "@/lib/requester-language";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import { appendText } from "@/lib/speech/use-speech-to-text";
import { requesterLocale, requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { SPOKEN_SKIP_INSTRUCTION, useBlindVoiceAnnouncement } from "@/components/requester/use-blind-voice-announcement";

type EmergencyContext = {
  id: string;
  category: string;
  severity: string;
  note: string;
  status: string;
  location: { address: string; lat?: number; lng?: number };
  responder?: { id: string; name: string } | null;
};

type Message = { id?: string; role: "assistant" | "user"; text: string; provider?: string; model?: string; quickReplies?: string[]; animateOnReplay?: boolean };
type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; messagesLoaded?: boolean };
type PendingChatTurn = { conversationId: string; title: string; user: Message; assistant: Message };
type AiChatMemory = { conversations: ChatConversation[]; activeConversationId: string; pendingTurns: PendingChatTurn[] };

const CHAT_CACHE_TTL = 12 * 60 * 60_000;

type AiLanguageHelpCopy = { title: string; intro: string; note: string; examplesTitle: string; examples: string[]; closeLabel: string; supportedLanguagesLabel: string };

const AI_LANGUAGE_HELP_COPY: Record<RequesterLanguage, AiLanguageHelpCopy> = {
  English: {
    title: "LIVE AI language support",
    intro: "LIVE AI supports answers in these languages:",
    note: "AI can misunderstand your question or give inaccurate answers, including in translations. Its replies are general information, not professional health advice. Rephrase your question if something is unclear, and verify important details.",
    examplesTitle: "Example questions",
    examples: ["What details should I share with the response team?", "What should I expect while waiting for help?", "Can you explain the status of my request?"],
    closeLabel: "Close AI language support",
    supportedLanguagesLabel: "Supported AI languages",
  },
  Afrikaans: {
    title: "LIVE AI-taalondersteuning",
    intro: "LIVE AI ondersteun antwoorde in hierdie tale:",
    note: "KI kan jou vraag verkeerd verstaan of onakkurate antwoorde gee, ook in vertalings. Antwoorde is algemene inligting en nie professionele gesondheidsadvies nie. Vra anders as iets onduidelik is, en bevestig belangrike besonderhede.",
    examplesTitle: "Voorbeeldvrae",
    examples: ["Watter besonderhede moet ek met die reaksiespan deel?", "Wat kan ek verwag terwyl ek vir hulp wag?", "Kan jy die status van my versoek verduidelik?"],
    closeLabel: "Sluit LIVE KI-taalondersteuning",
    supportedLanguagesLabel: "Ondersteunde KI-tale",
  },
  isiZulu: {
    title: "Ukusekelwa kwezilimi kwe-LIVE AI",
    intro: "I-LIVE AI isekela izimpendulo ngalezi zilimi:",
    note: "I-AI ingase ingawuqondi kahle umbuzo wakho noma inikeze izimpendulo ezingalungile, ngisho nasekuhumusheni. Izimpendulo ziyimininingwane ejwayelekile, azithathi indawo yeseluleko sochwepheshe bezempilo. Buza kabusha uma okuthile kungacacile, futhi uqinisekise imininingwane ebalulekile.",
    examplesTitle: "Imibuzo eyisibonelo",
    examples: ["Yiluphi ulwazi okufanele ngilunikeze ithimba eliphendulayo?", "Yini engingayilindela ngesikhathi ngisalinde usizo?", "Ungangichazela isimo sesicelo sami?"],
    closeLabel: "Vala usekelo lwezilimi lwe-LIVE AI",
    supportedLanguagesLabel: "Izilimi ezisekelwa yi-AI",
  },
  isiXhosa: {
    title: "Inkxaso yolwimi ye-LIVE AI",
    intro: "I-LIVE AI ixhasa iimpendulo ngezi lwimi:",
    note: "I-AI inokungawuqondi kakuhle umbuzo wakho okanye inike iimpendulo ezingachanekanga, kuquka kwiinguqulelo. Iimpendulo lulwazi ngokubanzi, azithathi indawo yengcebiso yengcali yezempilo. Buza ngenye indlela xa kukho into engacacanga, uze uqinisekise iinkcukacha ezibalulekileyo.",
    examplesTitle: "Imibuzo engumzekelo",
    examples: ["Zeziphi iinkcukacha ekufuneka ndizinike iqela eliphendulayo?", "Ndimele ndilindele ntoni ngoxa ndilinde uncedo?", "Ungandichazela imeko yesicelo sam?"],
    closeLabel: "Vala inkxaso yolwimi ye-LIVE AI",
    supportedLanguagesLabel: "Iilwimi ezixhaswa yi-AI",
  },
  Sesotho: {
    title: "Tšehetso ea lipuo ea LIVE AI",
    intro: "LIVE AI e tšehetsa likarabo ka lipuo tsena:",
    note: "AI e ka se utloisise potso ea hao hantle kapa ea fana ka likarabo tse fosahetseng, ho kenyeletsa le liphetolelo. Likarabo ke tlhahisoleseding e akaretsang, eseng keletso ea setsebi sa bophelo bo botle. Botsa hape ka tsela e 'ngoe ha ho sa hlaka, 'me u netefatse lintlha tsa bohlokoa.",
    examplesTitle: "Mehlala ea lipotso",
    examples: ["Ke lintlha life tseo ke lokelang ho li bolella sehlopha sa thuso?", "Nka lebella eng ha ke ntse ke emetse thuso?", "Na u ka ntlhalosetsa boemo ba kopo ea ka?"],
    closeLabel: "Koala tšehetso ea lipuo ea LIVE AI",
    supportedLanguagesLabel: "Lipuo tse tšehetsoeng ke AI",
  },
  Setswana: {
    title: "Tshegetso ya dipuo ya LIVE AI",
    intro: "LIVE AI e tshegetsa dikarabo ka dipuo tse:",
    note: "AI e ka se tlhaloganye potso ya gago sentle kgotsa ya naya dikarabo tse di sa nepahalang, le mo dithanolong. Dikarabo ke tshedimosetso ka kakaretso, ga se kgakololo ya moitseanape wa boitekanelo. Botsa gape ka tsela e nngwe fa sengwe se sa tlhaloganyesege, mme o netefatse dintlha tsa botlhokwa.",
    examplesTitle: "Dipotso tsa sekai",
    examples: ["Ke dintlha dife tse ke tshwanetseng go di bolelela setlhopha sa thuso?", "Nka lebelela eng fa ke sa ntse ke emetse thuso?", "A o ka ntlhalosetsa maemo a kopo ya me?"],
    closeLabel: "Tswala tshegetso ya dipuo ya LIVE AI",
    supportedLanguagesLabel: "Dipuo tse di tshegediwang ke AI",
  },
  Sepedi: {
    title: "Thekgo ya maleme ya LIVE AI",
    intro: "LIVE AI e thekga dikarabo ka maleme a:",
    note: "AI e ka se kwešiše potšišo ya gago gabotse goba ya fa dikarabo tše di fošagetšego, go akaretšwa le diphetolelo. Dikarabo ke tshedimošo ya kakaretšo, ga se keletšo ya tša maphelo ya setsebi. Botšiša gape ka tsela ye nngwe ge go na le se se sa kwagalego, gomme o kgonthišiše dintlha tša bohlokwa.",
    examplesTitle: "Mehlala ya dipotšišo",
    examples: ["Ke dintlha dife tše ke swanetšego go di abelana le sehlopha sa thušo?", "Nka letela eng ge ke sa emetše thušo?", "Na o ka hlaloša boemo bja kgopelo ya ka?"],
    closeLabel: "Tswalela thekgo ya maleme ya LIVE AI",
    supportedLanguagesLabel: "Maleme ao a thekgwago ke AI",
  },
  siSwati: {
    title: "Kwesekelwa kwetilwimi kwe-LIVE AI",
    intro: "I-LIVE AI isekela timphendvulo ngaletilwimi le:",
    note: "I-AI ingase ingawuva kahle umbuto wakho noma inike timphendvulo letingakalungi, lokufaka ekhatsi nekuhumusha. Timphendvulo tilwati loluvamile, akusiso seluleko sesati setemphilo. Phindza ubute ngalenye indlela nangabe kunalokungacaci, futsi uhlole kabusha imininingwane lebalulekile.",
    examplesTitle: "Tibonelo temibuto",
    examples: ["Nguyiphi imininingwane lokufanele ngiyabelane nelicembu lelisitako?", "Yini lengingayilindzela nangis alindzele lusito?", "Ungangichazela simo sesicelo sami?"],
    closeLabel: "Vala kwesekelwa kwetilwimi kwe-LIVE AI",
    supportedLanguagesLabel: "Tilwimi letisekelwa yi-AI",
  },
  Tshivenda: {
    title: "Thuso ya nyambo ya LIVE AI",
    intro: "LIVE AI i tikedza phindulo nga dzi nyambo dzi tevhelaho:",
    note: "AI i nga si pfesese mbudziso yaṋu zwavhuḓi kana ya ṋea phindulo dzi si dza vhukuma, na kha ṱhalutshedzelo. Phindulo ndi mafhungo a nga u angaredza, a si nyeletshedzo ya muthetshelesi wa zwa mutakalo. Vhudzisani hafhu nga iṅwe nḓila arali hu na zwi sa pfalesi, nahone ni khwaṱhisedze zwidodombedzwa zwa ndeme.",
    examplesTitle: "Mbudziso dza tsumbo",
    examples: ["Ndi zwidodombedzwa zwifhio zwine nda tea u kovhela tshigwada tsha thuso?", "Ndi tea u lavhelela mini musi ndi tshi kha ḓi lindela thuso?", "Ni nga ṱalutshedza vhuimo ha khumbelo yanga?"],
    closeLabel: "Vala thuso ya nyambo ya LIVE AI",
    supportedLanguagesLabel: "Nyambo dzi tikedzwaho nga AI",
  },
  isiNdebele: {
    title: "Usekelo lwelimi lwe-LIVE AI",
    intro: "I-LIVE AI isekela iimpendulo ngamalimi la:",
    note: "I-AI ingahle ingazwisisi kuhle umbuzo wakho kumbe ikunike iimpendulo ezinganembileko, kuhlanganise nezinye ezitjhugululiweko. Iimpendulo zililwazi elivamileko, azisiso iseluleko sezepilo sobungcweti. Buza godu ngenye indlela nange kukhona okungakazwisiseki, begodu uqinisekise imininingwana eqakathekileko.",
    examplesTitle: "Iimbonelo zemibuzo",
    examples: ["Ngimiphi imininingwana ekufanele ngiyabelane neqembu elisizako?", "Yini engingayilindela nangisalisalinde ukusizwa?", "Ungangihlathululela ubujamo besibawo sami?"],
    closeLabel: "Vala usekelo lwelimi lwe-LIVE AI",
    supportedLanguagesLabel: "Amalimi asekelwa yi-AI",
  },
  XiTsonga: {
    title: "Nseketelo wa tindzimi wa LIVE AI",
    intro: "LIVE AI yi seketela tinhlamulo hi tindzimi leti:",
    note: "AI yi nga ka yi nga twisisi xivutiso xa wena kahle kumbe yi nyika tinhlamulo leti nga riki kahle, ku katsa ni le ka vuhundzuluxeri. Tinhlamulo i mahungu ya ntolovelo, a hi xitsundzuxo xa rihanyu xa mutivi. Vutisa hi ndlela yin'wana loko ku nga twisiseki, kutani u tiyisisa vuxokoxoko bya nkoka.",
    examplesTitle: "Swikombiso swa swivutiso",
    examples: ["Hi byihi vuxokoxoko byo ndzi avelana na ntlawa lowu nyikaka mpfuneto?", "Xana ndzi nga langutela yini loko ndza ha rindzele mpfuneto?", "Xana u nga ndzi hlamusela xiyimo xa xikombelo xa mina?"],
    closeLabel: "Pfala nseketelo wa tindzimi wa LIVE AI",
    supportedLanguagesLabel: "Tindzimi leti seketeleriwaka hi AI",
  },
};

const AI_SUPPORTED_LANGUAGES = ["English", "Afrikaans", "isiZulu", "isiXhosa", "Sesotho", "Setswana"];

const REQUESTER_AI_WELCOME: Record<RequesterLanguage, {
  hello: string;
  intro: string;
  suggestions: Array<{ label: string; prompt: string }>;
  danger: string;
}> = {
  English: {
    hello: "Hi",
    intro: "I'm the LIVE assistant. I can help you request help, track your responder, or understand an update.",
    suggestions: [
      { label: "How do I request help?", prompt: "How do I request help?" },
      { label: "How do I track my request?", prompt: "How do I track my request?" },
      { label: "What do the statuses mean?", prompt: "What do the statuses mean?" },
      { label: "How do I use voice input?", prompt: "How do I use voice input?" },
      { label: "Emergency phone numbers", prompt: "Emergency phone numbers" },
    ],
    danger: "In danger now? Call",
  },
  Afrikaans: {
    hello: "Hallo",
    intro: "Ek is die LIVE-assistent. Ek kan jou help om hulp aan te vra, jou reageerder op te spoor, of 'n opdatering te verstaan.",
    suggestions: [
      { label: "Hoe vra ek hulp aan?", prompt: "How do I request help?" },
      { label: "Hoe volg ek my versoek?", prompt: "How do I track my request?" },
      { label: "Wat beteken die statusse?", prompt: "What do the statuses mean?" },
      { label: "Hoe gebruik ek steminvoer?", prompt: "How do I use voice input?" },
      { label: "Noodnommers", prompt: "Emergency phone numbers" },
    ],
    danger: "In onmiddellike gevaar? Bel",
  },
  isiZulu: {
    hello: "Sawubona",
    intro: "Ngingumsizi we-LIVE. Ngingakusiza ucele usizo, ulandele umphenduli wakho, noma uqonde isibuyekezo.",
    suggestions: [
      { label: "Ngilucela kanjani usizo?", prompt: "How do I request help?" },
      { label: "Ngisilandelela kanjani isicelo sami?", prompt: "How do I track my request?" },
      { label: "Zisho ukuthini izimo zesicelo?", prompt: "What do the statuses mean?" },
      { label: "Ngisebenzisa kanjani ukufaka ngezwi?", prompt: "How do I use voice input?" },
      { label: "Izinombolo zezimo eziphuthumayo", prompt: "Emergency phone numbers" },
    ],
    danger: "Usengozini manje? Shayela",
  },
  isiXhosa: {
    hello: "Molo",
    intro: "Ndingumncedisi we-LIVE. Ndingakunceda ucele uncedo, ulandele umphenduli wakho, okanye uqonde uhlaziyo.",
    suggestions: [
      { label: "Ndingalucela njani uncedo?", prompt: "How do I request help?" },
      { label: "Ndingasilandelela njani isicelo sam?", prompt: "How do I track my request?" },
      { label: "Zithetha ntoni iimeko zesicelo?", prompt: "What do the statuses mean?" },
      { label: "Ndilusebenzisa njani ungeniso lwelizwi?", prompt: "How do I use voice input?" },
      { label: "Iinombolo zikaxakeka", prompt: "Emergency phone numbers" },
    ],
    danger: "Usengozini ngoku? Fowunela",
  },
  Sesotho: {
    hello: "Lumela",
    intro: "Ke mothusi oa LIVE. Nka u thusa ho kopa thuso, ho sala mo arabeli morao, kapa ho utloisisa tsebiso.",
    suggestions: [
      { label: "Nka kopa thuso joang?", prompt: "How do I request help?" },
      { label: "Nka sala kopo ea ka morao joang?", prompt: "How do I track my request?" },
      { label: "Maemo a kopo a bolela eng?", prompt: "What do the statuses mean?" },
      { label: "Ke sebelisa ho kenya ka lentsoe joang?", prompt: "How do I use voice input?" },
      { label: "Linomoro tsa tšohanyetso", prompt: "Emergency phone numbers" },
    ],
    danger: "U kotsing hona joale? Letsetsa",
  },
  Setswana: {
    hello: "Dumela",
    intro: "Ke mothusi wa LIVE. Nka go thusa go kopa thuso, go sala motlhankedi morago, kgotsa go tlhaloganya kitsiso.",
    suggestions: [
      { label: "Nka kopa thuso jang?", prompt: "How do I request help?" },
      { label: "Nka sala kopo ya me morago jang?", prompt: "How do I track my request?" },
      { label: "Maemo a kopo a kaya eng?", prompt: "What do the statuses mean?" },
      { label: "Ke dirisa jang go tsenya ka lentswe?", prompt: "How do I use voice input?" },
      { label: "Dinomoro tsa tshoganyetso", prompt: "Emergency phone numbers" },
    ],
    danger: "O mo kotsing jaanong? Letsa",
  },
  Sepedi: { hello: "Dumela", intro: "Ke mothuši wa LIVE. Nka go thuša go kgopela thušo goba go kwešiša tsebišo.", suggestions: [], danger: "Ge o le kotsing bjale, letša" },
  siSwati: { hello: "Sawubona", intro: "Ngingumsiti we-LIVE. Ngingakusita ucele lusito noma ucondze sibuyekezo.", suggestions: [], danger: "Usengotini nyalo? Shayela" },
  Tshivenda: { hello: "Ndaa", intro: "Ndi muthusi wa LIVE. Ndi nga ni thusa u humbela thuso kana u pfesesa mafhungo.", suggestions: [], danger: "Ni khomboni zwino? Fonani" },
  isiNdebele: { hello: "Lotjhani", intro: "Ngingumsizi we-LIVE. Ngingakusiza ucele isizo namkha uzwisise umbiko.", suggestions: [], danger: "Usengozini nje? Tjhinga" },
  XiTsonga: { hello: "Avuxeni", intro: "Hi mina mupfuneti wa LIVE. Nd nga ku pfuna ku kombela mpfuno kumbe ku twisisa mhaka.", suggestions: [], danger: "U le khombyeni sweswi? Fonela" },
};

const REQUESTER_AI_WELCOME_SUGGESTIONS: Partial<Record<RequesterLanguage, Array<{ label: string; prompt: string }>>> = {
  Sepedi: [
    { label: "Nka kgopela thušo bjang?", prompt: "How do I request help?" },
    { label: "Nka latela kgopelo ya ka bjang?", prompt: "How do I track my request?" },
    { label: "Maemo a kgopelo a ra go reng?", prompt: "What do the statuses mean?" },
    { label: "Nka diriša bjang tsenyo ya lentšu?", prompt: "How do I use voice input?" },
    { label: "Dinomboro tša tšhoganetšo", prompt: "Emergency phone numbers" },
  ],
  siSwati: [
    { label: "Ngingalucela njani lusito?", prompt: "How do I request help?" },
    { label: "Ngingasilandzelela njani sicelo sami?", prompt: "How do I track my request?" },
    { label: "Tisho kutsini timo tesicelo?", prompt: "What do the statuses mean?" },
    { label: "Ngikusebenzisa njani kufaka ngelivi?", prompt: "How do I use voice input?" },
    { label: "Tinombolo tetimo letiphutfumako", prompt: "Emergency phone numbers" },
  ],
  Tshivenda: [
    { label: "Ndi humbela hani thuso?", prompt: "How do I request help?" },
    { label: "Ndi tevhela hani khumbelo yanga?", prompt: "How do I track my request?" },
    { label: "Vhuimo ha khumbelo yanga vhu amba mini?", prompt: "What do the statuses mean?" },
    { label: "Ndi shumisa hani u dzhenisa nga ipfi?", prompt: "How do I use voice input?" },
    { label: "Nomboro dza shishi", prompt: "Emergency phone numbers" },
  ],
  isiNdebele: [
    { label: "Ngisicela njani isizo?", prompt: "How do I request help?" },
    { label: "Ngisilandelela njani isibawo sami?", prompt: "How do I track my request?" },
    { label: "Ubujamo besibawo butjho ukuthini?", prompt: "What do the statuses mean?" },
    { label: "Ngikusebenzisa njani ukufaka ngelizwi?", prompt: "How do I use voice input?" },
    { label: "Iinomboro eziphuthumako", prompt: "Emergency phone numbers" },
  ],
  XiTsonga: [
    { label: "Xana ndzi kombela mpfuno hi ndlela yihi?", prompt: "How do I request help?" },
    { label: "Xana ndzi landzelela xikombelo xa mina hi ndlela yihi?", prompt: "How do I track my request?" },
    { label: "Xana swiyimo swa xikombelo swi vula yini?", prompt: "What do the statuses mean?" },
    { label: "Xana ndzi tirhisa ku nghenisa hi rito hi ndlela yihi?", prompt: "How do I use voice input?" },
    { label: "Tinomboro ta xihatla", prompt: "Emergency phone numbers" },
  ],
};

function chatCacheKey(requestId: string) {
  return `requester-ai-chats:v1:${requestId}`;
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>,
  );
}

function AssistantText({ text }: { text: string }) {
  const lines = formatAssistantAnswer(text, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const blocks: Array<{ type: "paragraph" | "bullet" | "numbered"; items: string[] }> = [];

  for (const line of lines) {
    const bullet = line.match(/^(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const type = bullet ? "bullet" : numbered ? "numbered" : "paragraph";
    const value = bullet?.[1] ?? numbered?.[1] ?? line;
    const previous = blocks.at(-1);

    if (previous?.type === type && type !== "paragraph") previous.items.push(value);
    else blocks.push({ type, items: [value] });
  }

  return <div className="space-y-3">{blocks.map((block, index) => {
    if (block.type === "bullet") return <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ul>;
    if (block.type === "numbered") return <ol key={index} className="list-decimal space-y-1 pl-5">{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ol>;
    return <p key={index}>{renderInline(block.items[0])}</p>;
  })}</div>;
}

function AnimatedAssistantText({ text }: { text: string }) {
  const [visibleText, setVisibleText] = useState("");
  useEffect(() => {
    const words = text.match(/\S+\s*/g) ?? [];
    let index = 0;
    if (!words.length) return;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleText(words.slice(0, index).join(""));
      if (index >= words.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [text]);
  return <AssistantText text={visibleText} />;
}

function animateLatestAssistantReply(messages: Message[]): Message[] {
  let latestAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].text.trim()) {
      latestAssistantIndex = index;
      break;
    }
  }
  return messages.map((message, index) => {
    const next = { ...message };
    delete next.animateOnReplay;
    if (index === latestAssistantIndex) next.animateOnReplay = true;
    return next;
  });
}

export function AiAssistantSheet({ open, onOpenChange, emergency }: { open: boolean; onOpenChange: (open: boolean) => void; emergency: EmergencyContext }) {
  const { startCall, call } = useCall();
  const { user } = useAuth();
  const uiLanguage = useRequesterLanguage(user?.id ?? "");
  const aiLanguage = requesterAiLanguage(uiLanguage);
  const aiLanguageHelp = AI_LANGUAGE_HELP_COPY[uiLanguage];
  const hasEmergency = Boolean(emergency.id);
  const localChatScopeId = emergency.id || `general:${user?.id ?? "requester"}`;
  // Intake questions only make sense once a real emergency request exists.
  const questions = useMemo(() => hasEmergency ? questionsForEmergency(emergency.category) : [], [emergency.category, hasEmergency]);
  const intake = useRequestIntakeAnswers(emergency.id);
  const [chatMemory, setChatMemory] = useState<AiChatMemory>({ conversations: [], activeConversationId: '', pendingTurns: [] });
  const chatMemoryRef = useRef(chatMemory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiLanguageHelpOpen, setAiLanguageHelpOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [conversationLoadErrorId, setConversationLoadErrorId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [voiceNavigationActive, setVoiceNavigationActive] = useState(false);
  const [voiceDictationFocused, setVoiceDictationFocused] = useState(false);
  const [voiceAnswerFeedback, setVoiceAnswerFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatSyncStatus, setChatSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const voiceInputBaseRef = useRef("");
  const voiceInputUtteranceRef = useRef("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const conversationChosenDuringLoadRef = useRef(false);

  useEffect(() => {
    if (!user?.id) { setVoiceNavigationActive(false); return; }
    const syncVoicePreference = () => {
      const preferences = readRequesterPreferences(user.id);
      setVoiceNavigationActive(preferences.voiceNavigation && preferences.voiceCommandsActive);
    };
    syncVoicePreference();
    window.addEventListener("live:requester-preferences-changed", syncVoicePreference);
    return () => window.removeEventListener("live:requester-preferences-changed", syncVoicePreference);
  }, [user?.id]);

  const updateChatMemory = (next: AiChatMemory) => {
    chatMemoryRef.current = next;
    setChatMemory(next);
    writeFreshCache(chatCacheKey(localChatScopeId), next, CHAT_CACHE_TTL);
  };
  const activeConversation = chatMemory.conversations.find((item) => item.id === chatMemory.activeConversationId);
  const messages = activeConversation?.messages ?? [];
  const unansweredQuestions = questions.filter((item) => !intake.answers[item.key]);
  const currentQuestion = unansweredQuestions[0];
  const questionNumber = questions.length - unansweredQuestions.length + 1;
  const questionAnnouncement = currentQuestion
    ? `${requesterText(uiLanguage, "Optional details")}, ${questionNumber} of ${questions.length}. ${requesterText(uiLanguage, currentQuestion.question)}. ${requesterText(uiLanguage, "Answer")}: ${currentQuestion.options.map((option) => requesterText(uiLanguage, option)).join(". ")}. ${SPOKEN_SKIP_INSTRUCTION[uiLanguage]}`
    : null;
  useBlindVoiceAnnouncement(questionAnnouncement, uiLanguage, open && Boolean(currentQuestion), user?.id);
  // Visible popup copy follows the selected interface language. Only the AI
  // reply target falls back when the selected language is not supported.
  const welcomeCopy = REQUESTER_AI_WELCOME[uiLanguage];
  const welcomeQuestions = welcomeCopy.suggestions.length
    ? welcomeCopy.suggestions
    : REQUESTER_AI_WELCOME_SUGGESTIONS[uiLanguage] ?? REQUESTER_AI_WELCOME.English.suggestions;

  function followUpQuestions(questionText: string) {
    const questionIndex = welcomeQuestions.findIndex((item) => item.label === questionText);
    const indexesByQuestion = [[1, 2], [2, 4], [1, 4], [0, 4], [0, 1]];
    const indexes = indexesByQuestion[questionIndex] ?? [0, 4];
    return indexes.map((index) => welcomeQuestions[index]?.label).filter((label): label is string => Boolean(label));
  }

  useEffect(() => {
    if (open && currentQuestion && historyOpen) setHistoryOpen(false);
  }, [currentQuestion, historyOpen, open]);

  useEffect(() => {
    if (!open) setAiLanguageHelpOpen(false);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || (historyOpen && !currentQuestion) || loadingConversationId === activeConversation?.id) return;
    const scrollContainer = chatScrollRef.current;
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [open, historyOpen, currentQuestion, loadingConversationId, activeConversation?.id, messages, busy, keyboardOffset]);

  async function persistChatTurn(turn: PendingChatTurn) {
    try {
      const response = await authenticatedFetch('/api/requester/ai/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: emergency.id, conversationId: turn.conversationId, title: turn.title, messages: [
          { id: turn.user.id, role: 'user', content: turn.user.text },
          { id: turn.assistant.id, role: 'assistant', content: turn.assistant.text, provider: turn.assistant.provider, model: turn.assistant.model },
        ] }),
      });
      if (!response.ok) throw new Error('Chat save failed.');
      const current = chatMemoryRef.current;
      updateChatMemory({ ...current, pendingTurns: current.pendingTurns.filter((item) => item.user.id !== turn.user.id) });
      setChatSyncStatus('saved');
    } catch { setChatSyncStatus('error'); }
  }

  function recordTurn(conversationId: string, userMessage: Message, assistantMessage: Message) {
    const current = chatMemoryRef.current;
    const selected = current.conversations.find((item) => item.id === conversationId);
    if (!selected) return;
    const title = selected.title === 'New chat' ? userMessage.text.slice(0, 80) : selected.title;
    const now = new Date().toISOString();
    const turn: PendingChatTurn = { conversationId, title, user: { ...userMessage, id: userMessage.id ?? crypto.randomUUID() }, assistant: { ...assistantMessage, quickReplies: assistantMessage.quickReplies ?? followUpQuestions(userMessage.text), id: assistantMessage.id ?? crypto.randomUUID() } };
    updateChatMemory({
      ...current,
      conversations: current.conversations.map((item) => item.id === conversationId
        ? { ...item, title, updatedAt: now, messages: [...item.messages.filter((message) => message.id !== turn.user.id && message.id !== turn.assistant.id), turn.user, turn.assistant], messagesLoaded: true }
        : item),
      pendingTurns: hasEmergency ? [...current.pendingTurns, turn] : current.pendingTurns,
    });
    if (hasEmergency) {
      setChatSyncStatus('saving');
      void persistChatTurn(turn);
    } else {
      setChatSyncStatus('saved');
    }
  }

  useEffect(() => {
    if (!open) { setKeyboardOffset(0); return; }
    const viewport = window.visualViewport;
    const virtualKeyboard = (navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean; boundingRect: DOMRect; addEventListener: (type: 'geometrychange', listener: () => void) => void; removeEventListener: (type: 'geometrychange', listener: () => void) => void } }).virtualKeyboard;
    if (virtualKeyboard) virtualKeyboard.overlaysContent = true;
    const syncKeyboardOffset = () => {
      if (virtualKeyboard?.boundingRect.height) setKeyboardOffset(virtualKeyboard.boundingRect.height);
      else if (viewport) setKeyboardOffset(Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop)));
    };
    syncKeyboardOffset();
    viewport?.addEventListener('resize', syncKeyboardOffset);
    viewport?.addEventListener('scroll', syncKeyboardOffset);
    virtualKeyboard?.addEventListener('geometrychange', syncKeyboardOffset);
    return () => {
      viewport?.removeEventListener('resize', syncKeyboardOffset);
      viewport?.removeEventListener('scroll', syncKeyboardOffset);
      virtualKeyboard?.removeEventListener('geometrychange', syncKeyboardOffset);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    conversationChosenDuringLoadRef.current = false;
    const key = chatCacheKey(localChatScopeId);
    const cached = readCached<AiChatMemory>(key);
    const fresh = readFreshCache<AiChatMemory>(key);
    const initial = cached ?? { conversations: [], activeConversationId: '', pendingTurns: [] };
    if (!initial.activeConversationId || !initial.conversations.some((item) => item.id === initial.activeConversationId)) {
      const first = initial.conversations[0];
      initial.activeConversationId = first?.id ?? crypto.randomUUID();
      if (!first) initial.conversations.unshift({ id: initial.activeConversationId, title: 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], messagesLoaded: true });
    }
    initial.conversations = initial.conversations.map((item) => item.id === initial.activeConversationId
      ? { ...item, messages: animateLatestAssistantReply(item.messages) }
      : item);
    updateChatMemory(initial);
    if (hasEmergency) initial.pendingTurns.forEach((turn) => void persistChatTurn(turn));
    const retryPendingChats = () => chatMemoryRef.current.pendingTurns.forEach((turn) => void persistChatTurn(turn));
    if (hasEmergency) window.addEventListener('online', retryPendingChats);
    const hasCachedSavedChats = initial.conversations.some((item) => item.messages.length > 0 || item.title !== 'New chat');
    if (hasEmergency && (!fresh || !hasCachedSavedChats)) {
      void authenticatedFetch('/api/requester/ai/chats?requestId=' + encodeURIComponent(emergency.id), { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('Could not load chat history.');
          const payload = await response.json() as { data?: { conversations?: Array<{ id: string; title: string; created_at: string; updated_at: string }> } };
          const serverConversations = payload.data?.conversations ?? [];
          const current = chatMemoryRef.current;
          const byId = new Map(current.conversations.map((item) => [item.id, item]));
          for (const item of serverConversations) {
            const local = byId.get(item.id);
            byId.set(item.id, { id: item.id, title: item.title, createdAt: item.created_at, updatedAt: item.updated_at, messages: local?.messages ?? [], messagesLoaded: local?.messagesLoaded ?? false });
          }
          updateChatMemory({ ...current, conversations: [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) });
          const latestServerConversation = [...serverConversations].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
          if (latestServerConversation && !conversationChosenDuringLoadRef.current) {
            void openConversation(latestServerConversation.id);
          }
        }).catch(() => { /* Keep the per-tab cache usable while offline. */ });
    }
    return () => {
      if (hasEmergency) window.removeEventListener('online', retryPendingChats);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, emergency.id, hasEmergency, localChatScopeId]);

  function startNewChat() {
    if (busy || currentQuestion) return;
    conversationChosenDuringLoadRef.current = true;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const current = chatMemoryRef.current;
    updateChatMemory({ ...current, activeConversationId: id, conversations: [{ id, title: 'New chat', createdAt: now, updatedAt: now, messages: [], messagesLoaded: true }, ...current.conversations] });
    setHistoryOpen(false);
    setQuestion('');
  }

  async function refreshChatHistory() {
    if (!hasEmergency) return;
    setHistoryLoading(true);
    try {
      const response = await authenticatedFetch('/api/requester/ai/chats?requestId=' + encodeURIComponent(emergency.id), { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not refresh chat history.');
      const payload = await response.json() as { data?: { conversations?: Array<{ id: string; title: string; created_at: string; updated_at: string }> } };
      const current = chatMemoryRef.current;
      const byId = new Map(current.conversations.map((item) => [item.id, item]));
      for (const item of payload.data?.conversations ?? []) {
        const local = byId.get(item.id);
        byId.set(item.id, { id: item.id, title: item.title, createdAt: item.created_at, updatedAt: item.updated_at, messages: local?.messages ?? [], messagesLoaded: local?.messagesLoaded ?? false });
      }
      updateChatMemory({ ...current, conversations: [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) });
    } catch {
      setChatSyncStatus('error');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openConversation(conversationId: string) {
    conversationChosenDuringLoadRef.current = true;
    const current = chatMemoryRef.current;
    updateChatMemory({
      ...current,
      activeConversationId: conversationId,
      conversations: current.conversations.map((item) => item.id === conversationId
        ? { ...item, messages: item.messagesLoaded ? animateLatestAssistantReply(item.messages) : item.messages }
        : item),
    });
    setHistoryOpen(false);
    setConversationLoadErrorId(null);
    const conversation = current.conversations.find((item) => item.id === conversationId);
    if (!conversation || conversation.messagesLoaded || !hasEmergency) {
      setLoadingConversationId(null);
      return;
    }
    setLoadingConversationId(conversationId);
    try {
      const response = await authenticatedFetch('/api/requester/ai/chats?requestId=' + encodeURIComponent(emergency.id) + '&conversationId=' + encodeURIComponent(conversationId), { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load this chat.');
      const payload = await response.json() as { data?: { conversation?: { messages?: Array<{ role: 'user' | 'assistant'; content: string; provider?: string | null; model?: string | null }> } } };
      const loaded = animateLatestAssistantReply((payload.data?.conversation?.messages ?? []).map((item) => ({ role: item.role, text: item.content, provider: item.provider ?? undefined, model: item.model ?? undefined })));
      const latest = chatMemoryRef.current;
      updateChatMemory({ ...latest, conversations: latest.conversations.map((item) => item.id === conversationId ? { ...item, messages: loaded, messagesLoaded: true } : item) });
    } catch {
      setConversationLoadErrorId(conversationId);
    } finally {
      setLoadingConversationId((currentId) => currentId === conversationId ? null : currentId);
    }
  }

  function stopGeneration() { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }

  async function ask(text: string) {
    const trimmed = text.trim();
    const conversationId = chatMemoryRef.current.activeConversationId;
    if (!trimmed || busy || !conversationId) return;
    setQuestion('');
    setVoiceDictationFocused(false);
    voiceInputUtteranceRef.current = "";
    voiceInputBaseRef.current = "";
    setBusy(true);
    const userMessage: Message = { role: 'user', text: trimmed, id: crypto.randomUUID() };
    if (/\b(call|phone|contact|speak to|talk to)\b.*\b(driver|responder)\b|\b(driver|responder)\b.*\b(call|phone|contact|speak|talk)\b/i.test(trimmed)) {
      let answer: string;
      if (!emergency.responder?.id) answer = 'No responder is assigned to this request yet. You can share an update with LIVE, but there is no responder to call.';
      else if (call.status !== 'idle') answer = 'A call is already active. Use the call controls on screen to continue or end it.';
      else { await startCall(emergency.id, emergency.responder.name, { targetRole: 'responder', targetUserId: emergency.responder.id }); answer = 'Calling responder ' + emergency.responder.name + ' now.'; }
      recordTurn(conversationId, userMessage, { role: 'assistant', text: answer, provider: 'LIVE action', model: 'call control' });
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const visibleMessages = [...messages, userMessage];
    const assistantId = crypto.randomUUID();
    const assistantDraft: Message = { id: assistantId, role: 'assistant', text: '' };
    const updateAssistantDraft = (draft: Message) => {
      const current = chatMemoryRef.current;
      updateChatMemory({ ...current, conversations: current.conversations.map((item) => item.id === conversationId
        ? { ...item, messages: item.messages.some((message) => message.id === assistantId)
          ? item.messages.map((message) => message.id === assistantId ? draft : message)
          : [...item.messages, draft], messagesLoaded: true }
        : item) });
    };
    updateChatMemory({ ...chatMemoryRef.current, conversations: chatMemoryRef.current.conversations.map((item) => item.id === conversationId ? { ...item, messages: [...visibleMessages, assistantDraft], messagesLoaded: true } : item) });
    try {
      const aiEmergency = { id: emergency.id || 'general', category: emergency.category || 'General assistance', severity: emergency.severity || 'High', note: emergency.note ?? '', status: emergency.status ?? '', location: { address: emergency.location.address ?? 'Location unavailable' } };
      const aiMessages = visibleMessages.filter((message) => message.role === 'user' || (message.provider && message.model)).slice(-12).map((message) => ({ role: message.role, text: message.text.slice(-1200) }));
      const aiAnswers = Object.values(intake.answers).filter((item) => !item.skipped && item.answer).slice(-20).map((item) => ({ question: item.question.slice(0, 500), answer: (item.answer ?? '').slice(0, 200) }));
      const response = await authenticatedFetch('/api/requester/ai', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emergency: aiEmergency, question: trimmed.slice(0, 500), messages: aiMessages, answers: aiAnswers, language: user?.id ? readRequesterLanguage(user.id) : 'English' }) });
      if (!response.ok) {
        const payload = await response.json() as { error?: { message?: string } | string };
        throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || 'The assistant is unavailable.');
      }
      if (!response.body) throw new Error('LIVE AI returned no response stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let source: { provider: string; model: string } = { provider: '', model: '' };
      const consumeEvent = (eventBlock: string) => {
        const lines = eventBlock.split('\n');
        const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const dataText = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!dataText) return;
        const data = JSON.parse(dataText) as { text?: string; answer?: string; provider?: string; model?: string; message?: string };
        if (eventName === 'delta' && typeof data.text === 'string') {
          answer += data.text;
          updateAssistantDraft({ ...assistantDraft, text: answer });
        } else if (eventName === 'final') {
          if (typeof data.answer === 'string') answer = data.answer;
          source = { provider: data.provider ?? '', model: data.model ?? '' };
          updateAssistantDraft({ ...assistantDraft, text: answer, ...source });
        } else if (eventName === 'error') {
          throw new Error(data.message || 'LIVE AI could not finish its answer.');
        }
      };

      let streamDone = false;
      while (!streamDone) {
        const chunk = await reader.read();
        buffer = (buffer + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n');
        let separator = buffer.indexOf('\n\n');
        while (separator >= 0) {
          consumeEvent(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf('\n\n');
        }
        streamDone = chunk.done;
      }
      if (buffer.trim()) consumeEvent(buffer);
      if (!answer.trim() || !source.provider || !source.model) throw new Error('LIVE AI did not finish a valid answer.');
      recordTurn(conversationId, userMessage, { ...assistantDraft, text: answer, ...source });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const current = chatMemoryRef.current;
      const failedMessage: Message = { role: 'assistant', text: error instanceof Error ? error.message : 'The assistant is unavailable right now.' };
      updateChatMemory({ ...current, conversations: current.conversations.map((item) => item.id === conversationId ? { ...item, messages: [...item.messages.filter((message) => message.id !== userMessage.id && message.id !== assistantId), userMessage, failedMessage], messagesLoaded: true } : item) });
    } finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); }
  }

  useEffect(() => {
    if (!open) return;
    const handleVoiceAnswer = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; utteranceKey?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail) return;
      detail.consumed = true;
      const transcript = detail?.transcript?.trim();
      if (!transcript) return;
      const utteranceKey = detail.utteranceKey ?? "";
      if (!detail.isFinal) {
        if (currentQuestion) return;
        if (!utteranceKey || voiceInputUtteranceRef.current !== utteranceKey) {
          voiceInputUtteranceRef.current = utteranceKey;
          voiceInputBaseRef.current = question;
        }
        const base = voiceInputBaseRef.current.trimEnd();
        setQuestion(`${base ? `${base} ` : ""}${transcript}`.slice(0, 500));
        setVoiceDictationFocused(true);
        return;
      }
      const voiceBase = utteranceKey && voiceInputUtteranceRef.current === utteranceKey
        ? voiceInputBaseRef.current
        : question;
      const clearVoicePreview = () => {
        voiceInputUtteranceRef.current = "";
        voiceInputBaseRef.current = "";
        setQuestion(voiceBase);
        setVoiceDictationFocused(false);
      };
      const commitVoiceQuestion = () => {
        voiceInputUtteranceRef.current = "";
        voiceInputBaseRef.current = "";
        setQuestion(appendText(voiceBase, transcript, 500));
        setVoiceDictationFocused(true);
      };
      const spoken = normalizeSpokenIntakeAnswer(transcript);
      const clearWords = spoken.split(" ");
      const clearVerbs = new Set(["clear", "erase", "remove", "delete"]);
      const clearTargets = new Set(["input", "question", "text", "message", "draft", "it"]);
      const clearFiller = new Set(["please", "yeah", "yes", "okay", "ok", "just", "now", "the", "my", "chat"]);
      const isClearInputCommand = clearWords.length <= 8
        && clearWords.some((word) => clearVerbs.has(word))
        && clearWords.some((word) => clearTargets.has(word))
        && clearWords.every((word) => clearVerbs.has(word) || clearTargets.has(word) || clearFiller.has(word));
      if (isClearInputCommand) {
        clearVoicePreview();
        setQuestion("");
        return;
      }
      if (/^(?:please )?(?:close|dismiss|exit) (?:the )?(?:(?:live )?ai|eye)(?: help)?(?: (?:pop ?up|sheet|window))?$/.test(spoken)
        || /^(?:please )?(?:close|dismiss|exit) (?:this )?(?:pop ?up|sheet|window)$/.test(spoken)) {
        clearVoicePreview();
        onOpenChange(false);
        return;
      }
      if (currentQuestion) {
        const skipCurrent = isRequestIntakeSkipCurrent(transcript, requesterText(uiLanguage, "Skip this question"));
        if (skipCurrent) {
          setVoiceAnswerFeedback("");
          intake.saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: null, skipped: true, source: "ai_assistant" }]);
          return;
        }
        const skipRemaining = isRequestIntakeSkipRemaining(transcript, requesterText(uiLanguage, "Skip remaining questions"));
        if (skipRemaining) {
          setVoiceAnswerFeedback("");
          intake.saveAnswers(unansweredQuestions.map((item) => ({ question_key: item.key, question: item.question, answer: null, skipped: true, source: "ai_assistant" })));
          return;
        }
        const answer = matchRequestIntakeOption(transcript, currentQuestion.options, (option) => requesterText(uiLanguage, option));
        if (answer) {
          setVoiceAnswerFeedback("");
          intake.saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer, skipped: false, source: "ai_assistant" }]);
          return;
        }
        setVoiceAnswerFeedback(requesterText(uiLanguage, "I couldn't match that to an answer. Say one of the listed options, or say skip this question."));
        return;
      }
      if (/^(?:please )?(?:start|open|create) (?:a )?new chat$/.test(spoken)) {
        clearVoicePreview();
        startNewChat();
        return;
      }
      if (/^(?:please )?(?:open|show) (?:the )?(?:chat )?history$/.test(spoken)) {
        clearVoicePreview();
        setHistoryOpen(true);
        void refreshChatHistory();
        return;
      }
      if (busy) {
        commitVoiceQuestion();
        return;
      }
      if (historyOpen) setHistoryOpen(false);
      commitVoiceQuestion();
    };
    window.addEventListener("live:requester-voice-input", handleVoiceAnswer);
    return () => window.removeEventListener("live:requester-voice-input", handleVoiceAnswer);
  }, [busy, currentQuestion, historyOpen, intake.saveAnswers, onOpenChange, open, question, uiLanguage, unansweredQuestions]);

  const historyItems = [...chatMemory.conversations].filter((item) => item.messages.length > 0 || item.title !== 'New chat').sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[120] md:flex md:items-end md:justify-end md:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label={aiLanguageHelp.closeLabel} className="absolute inset-0 z-0 bg-[#071a29]/45 md:bg-transparent" onClick={() => onOpenChange(false)} />
          <motion.section role="dialog" aria-modal="true" aria-label={requesterText(uiLanguage, "LIVE AI help")} tabIndex={-1} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 330, damping: 34 }} className="absolute inset-0 z-10 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#f6f8fb] shadow-2xl md:relative md:inset-auto md:h-[min(760px,calc(100dvh-3rem))] md:max-h-[calc(100dvh-3rem)] md:w-[min(520px,calc(100vw-3rem))] md:rounded-2xl md:border md:border-[#dce5ea] md:shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dce5ea] bg-white px-5 py-4 sm:px-6">
              <div><h2 className="font-semibold text-[#102b3f]">{requesterText(uiLanguage, "LIVE AI help")}</h2><p className="text-[11px] text-[#81909a]">{activeConversation?.title ?? requesterText(uiLanguage, "New chat")}</p></div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={aiLanguageHelp.title}
                  aria-label={`${aiLanguageHelp.title}: ${aiLanguage}`}
                  aria-haspopup="dialog"
                  aria-expanded={aiLanguageHelpOpen}
                  aria-controls="live-ai-language-help"
                  onClick={() => setAiLanguageHelpOpen(true)}
                  className="mr-1 inline-flex h-8 items-center rounded-full border border-[#dce5ea] bg-[#f1f5f7] px-2.5 text-[11px] font-semibold text-[#526a78] transition hover:border-[#0f6872] hover:text-[#0f6872] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0f6872]"
                >
                  {aiLanguage}
                </button>
                <Button data-live-ai-header-control type="button" variant="ghost" size="icon" aria-label={requesterText(uiLanguage, "New chat")} title={requesterText(uiLanguage, "New chat")} disabled={busy || Boolean(currentQuestion)} onClick={startNewChat}><Plus className="h-4 w-4" /></Button><Button data-live-ai-header-control type="button" variant="ghost" size="icon" aria-label={requesterText(uiLanguage, "Chat history")} title={requesterText(uiLanguage, "Chat history")} disabled={Boolean(currentQuestion)} onClick={() => { if (historyOpen) setHistoryOpen(false); else { setHistoryOpen(true); void refreshChatHistory(); } }}><History className="h-4 w-4" /></Button><Button data-live-ai-header-control variant="ghost" size="icon" aria-label={requesterText(uiLanguage, "Close")} onClick={() => onOpenChange(false)}><X className="h-5 w-5" /></Button>
              </div>
            </header>
            <div data-live-voice-status-host="true" className="flex shrink-0 justify-end empty:hidden bg-white" />
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#f0d0ce] bg-[#fff4f3] px-4 py-2 text-xs font-semibold text-[#8d2b29] sm:px-5">
              <span>{welcomeCopy.danger}</span>
              {[
                ["10177", "Ambulance and fire"],
                ["10111", "Police (SAPS)"],
                ["112", "Mobile emergency"],
              ].map(([number, label]) => (
                <a key={number} href={`tel:${number}`} aria-label={`${requesterText(uiLanguage, label)}, ${number}`} className="inline-flex min-h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[#b3302e] ring-1 ring-[#f0c8c7] transition hover:bg-[#ffeded]">
                  <Phone className="h-3 w-3" />{number}
                </a>
              ))}
            </div>
            <div data-live-voice-focus-hint className="hidden shrink-0 items-center gap-2 border-b border-[#f1dfa9] bg-[#fff8df] px-5 py-2 text-xs font-semibold text-[#705400] sm:px-6">{requesterText(uiLanguage, 'Voice control is active. Say "next option", "previous option", "select", "button six", or "close".')}</div>
            {loadingConversationId === activeConversation?.id ? <div role="status" aria-label={requesterText(uiLanguage, "Loading earlier chat")} aria-live="polite" className="shrink-0 space-y-3 border-b border-[#dce5ea] bg-white px-5 py-4 sm:px-6"><div className="ml-auto h-10 w-2/3 animate-pulse rounded-2xl rounded-br-sm bg-[#e4eaee]" /><div className="mr-auto h-16 w-5/6 animate-pulse rounded-2xl rounded-bl-sm bg-[#e4eaee]" /><div className="mr-auto h-5 w-1/2 animate-pulse rounded-full bg-[#e4eaee]" /><span className="sr-only">{requesterText(uiLanguage, "Loading earlier chat...")}</span></div> : null}
            {conversationLoadErrorId === activeConversation?.id ? <div role="alert" className="flex shrink-0 items-center justify-center gap-2 border-b border-[#dce5ea] bg-white px-4 py-3 text-sm text-[#9b5b18]">{requesterText(uiLanguage, "Could not load this chat.")} <button type="button" onClick={() => void openConversation(activeConversation.id)} className="font-semibold underline">{requesterText(uiLanguage, "Retry")}</button></div> : null}
            <div ref={chatScrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          {historyOpen && !currentQuestion ? <section className="space-y-3"><h3 className="text-sm font-semibold text-[#102b3f]">{requesterText(uiLanguage, hasEmergency ? "Past chats for this emergency" : "Past chats")}</h3>{historyLoading ? <p className="text-xs text-[#81909a]">{requesterText(uiLanguage, "Updating chat list...")}</p> : null}{historyItems.length ? <div className="border-y border-[#dce5ea]">{historyItems.map((item, index) => <button key={item.id} type="button" onClick={() => void openConversation(item.id)} className={`w-full border-b border-[#dce5ea] px-1 py-4 text-left hover:bg-white/60 ${index === historyItems.length - 1 ? "last:border-b-0" : ""}`}><span className="block truncate text-sm font-semibold text-[#102b3f]">{item.title}</span><span className="mt-1 block text-xs text-[#81909a]">{new Intl.DateTimeFormat(requesterLocale(uiLanguage), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.updatedAt))}</span></button>)}</div> : <p className="text-sm text-[#71838f]">{requesterText(uiLanguage, hasEmergency ? "No saved chats for this emergency yet." : "No saved chats yet.")}</p>}</section> : <div className="space-y-5">
                {currentQuestion ? (
                  <section className="border-y border-[#dce5ea] bg-white px-3 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">{requesterText(uiLanguage, "Optional details")}</p>
                      <span className="text-xs font-semibold text-[#758793]">{questionNumber} / {questions.length}</span>
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.div key={currentQuestion.key} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="mt-3">
                        <div className="flex items-start gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0f6872] text-sm font-bold text-white">{questionNumber}</span>
                          <h3 className="pt-1 font-semibold leading-6 text-[#102b3f]">{requesterText(uiLanguage, currentQuestion.question)}</h3>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {currentQuestion.options.map((option) => <button data-live-voice-option key={option} type="button" onClick={() => { setVoiceAnswerFeedback(""); intake.saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: option, skipped: false, source: 'ai_assistant' }]); }} className="group flex w-full items-center gap-3 rounded-xl border border-[#dce5ea] px-3 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:border-[#0f6872] hover:bg-[#f4fafb] hover:text-[#0f6872]"><span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-[#9aabb5] group-hover:border-[#0f6872]" /><span>{requesterText(uiLanguage, option)}</span></button>)}
                        </div>
                        <p className="mt-3 text-center text-xs text-[#71838f]">{requesterText(uiLanguage, "With voice commands on, say one of the listed answers or say skip this question.")}</p>
                        {voiceAnswerFeedback ? <p role="status" className="mt-2 text-center text-xs font-semibold text-[#9b5b18]">{voiceAnswerFeedback}</p> : null}
                        <button type="button" onClick={() => { setVoiceAnswerFeedback(""); intake.saveAnswers([{ question_key: currentQuestion.key, question: currentQuestion.question, answer: null, skipped: true, source: 'ai_assistant' }]); }} className="mx-auto mt-4 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2">{requesterText(uiLanguage, "Skip this question")}</button>
                        <button type="button" onClick={() => { setVoiceAnswerFeedback(""); intake.saveAnswers(unansweredQuestions.map((item) => ({ question_key: item.key, question: item.question, answer: null, skipped: true, source: 'ai_assistant' }))); }} className="mx-auto mt-3 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2">{requesterText(uiLanguage, "Skip remaining questions")}</button>
                      </motion.div>
                    </AnimatePresence>
                    <p className="mt-3 border-t border-[#edf1f3] pt-3 text-center text-[11px] text-[#81909a]">{intake.syncStatus === 'saving' ? requesterText(uiLanguage, 'Saving answers...') : intake.syncStatus === 'error' ? requesterText(uiLanguage, 'Saved on this device. Database sync will retry when connected.') : requesterText(uiLanguage, 'Your answer appears here, on Request help, and to the dispatcher.')}</p>
                    {intake.syncStatus === 'error' ? <button type="button" onClick={() => void intake.retryPending()} className="mx-auto mt-1 block text-xs font-semibold text-[#0f6872] underline">{requesterText(uiLanguage, "Retry save")}</button> : null}
                  </section>
                ) : null}
                <section className={currentQuestion ? "hidden" : "space-y-3"}>
                  {messages.length === 0 ? (
                    <div className="space-y-3">
                      <div className="mr-4 w-fit max-w-[92%] break-words rounded-2xl rounded-bl-sm bg-[#f1f5f7] px-4 py-3 text-sm leading-6 text-[#526a78] shadow-[0_1px_2px_rgba(16,43,63,0.04)]">
                        <p><strong className="font-semibold text-[#102b3f]">{welcomeCopy.hello}{user?.firstName ? `, ${user.firstName}` : ""}!</strong> {welcomeCopy.intro}</p>
                      </div>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={requesterText(uiLanguage, "Suggested questions")}>
                        {welcomeQuestions.map((item) => (
                          <button key={item.label} type="button" disabled={busy} onClick={() => void ask(item.label)} className="min-h-9 rounded-full border border-[#cfdbe1] bg-white px-3 text-left text-xs font-semibold text-[#0f6872] transition hover:border-[#0f6872] hover:bg-[#e7f3f4] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6872]/20">
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {messages.map((message, index) => (
                    <div key={message.id ?? message.role + '-' + index} data-live-no-translate={message.provider === 'LIVE AI' ? '' : undefined} className={`${message.role === 'user' ? 'live-ai-user-message ml-auto w-fit max-w-[92%] break-words rounded-2xl rounded-br-sm bg-[#0f6872] px-4 py-3 text-sm leading-6 text-white shadow-[0_2px_5px_rgba(15,104,114,0.12)]' : 'live-ai-assistant-message mr-auto w-fit max-w-[92%] break-words rounded-2xl rounded-bl-sm bg-[#f1f5f7] px-4 py-3 text-sm leading-6 text-[#526a78] shadow-[0_1px_2px_rgba(16,43,63,0.04)]'}`}>
                      {message.animateOnReplay ? <AnimatedAssistantText key={message.id ?? 'replayed-answer-' + index} text={message.text} /> : <AssistantText text={message.text} />}
                      {message.role === 'assistant' && message === messages.at(-1) && message.quickReplies?.length && !busy ? (
                        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={requesterText(uiLanguage, "Suggested questions")}>
                          {message.quickReplies.map((reply) => (
                            <button key={reply} type="button" onClick={() => void ask(reply)} className="min-h-9 rounded-full border border-[#cfdbe1] bg-white px-3 text-left text-xs font-semibold text-[#0f6872] transition hover:border-[#0f6872] hover:bg-[#e7f3f4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6872]/20">
                              {reply}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {busy ? <div className="flex justify-center py-2" aria-label={requesterText(uiLanguage, "LIVE AI is thinking")} aria-live="polite"><span className="inline-flex items-center gap-1 text-lg font-bold leading-none text-[#0f6872]" aria-hidden="true"><span className="animate-bounce">.</span><span className="animate-bounce [animation-delay:120ms]">.</span><span className="animate-bounce [animation-delay:240ms]">.</span></span></div> : null}
                  {chatSyncStatus === 'error' ? <p className="text-center text-xs text-[#9b5b18]">{requesterText(uiLanguage, "Chat is saved on this device; database sync will retry when connected.")}</p> : null}
                </section>
              </div>}
            </div>
            {!historyOpen && !currentQuestion ? (
              <div className="relative z-20 shrink-0 border-t border-[#dce5ea] bg-white p-4 sm:p-5" style={{ transform: keyboardOffset ? 'translateY(-' + keyboardOffset + 'px)' : undefined, transition: 'transform 120ms ease-out' }}>
                <div className="relative">
                  <input
                    ref={questionInputRef}
                    data-live-keyboard-scroll-self
                    value={question}
                    onChange={(event) => { setQuestion(event.target.value); setVoiceDictationFocused(false); voiceInputUtteranceRef.current = ""; voiceInputBaseRef.current = ""; }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void ask(question); }}
                    placeholder={requesterText(uiLanguage, hasEmergency ? "Ask about this emergency" : "Ask LIVE AI a question")}
                    className={`h-11 w-full rounded-full border border-[#d6e1e6] px-3 ${question.trim() ? (voiceNavigationActive ? 'pr-36' : 'pr-24') : (voiceNavigationActive ? 'pr-24' : 'pr-14')} text-sm outline-none focus:border-[#0f6872]`}
                  />
                  <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {question.trim() ? (
                      <button
                        type="button"
                        aria-label={requesterText(uiLanguage, "Clear question")}
                        title={requesterText(uiLanguage, "Clear question")}
                        onClick={() => { setQuestion(""); setVoiceDictationFocused(false); voiceInputUtteranceRef.current = ""; voiceInputBaseRef.current = ""; questionInputRef.current?.focus(); }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#71838f] transition hover:bg-[#eef3f5] hover:text-[#0f6872] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6872]/20"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                    {voiceNavigationActive ? (
                      <button
                        type="button"
                        data-live-voice-option
                        aria-label={requesterText(uiLanguage, "Focus the question box for voice input")}
                        title={requesterText(uiLanguage, "Speak your question; it will appear here for you to review before sending")}
                        onClick={() => { setVoiceDictationFocused(true); questionInputRef.current?.focus(); }}
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6872]/20 ${voiceDictationFocused ? 'bg-[#e7f3f4] text-[#0f6872]' : 'text-[#71838f] hover:bg-[#eef3f5] hover:text-[#0f6872]'}`}
                      >
                        <Mic className="h-4 w-4" />
                      </button>
                    ) : null}
                    <Button type="button" size="icon" className="relative h-9 w-9 shrink-0 rounded-full" disabled={!busy && !question.trim()} onClick={() => busy ? stopGeneration() : void ask(question)} aria-label={busy ? requesterText(uiLanguage, 'Stop LIVE AI') : requesterText(uiLanguage, 'Ask LIVE AI')}>
                      {busy ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                {voiceNavigationActive && voiceDictationFocused ? <p className="mt-1 px-2 text-center text-[11px] leading-4 text-[#0f6872]">{requesterText(uiLanguage, "Speak your question. Review the words here, then tap Send.")}</p> : null}
                <p className="mt-2 px-1 text-center text-[11px] leading-4 text-[#81909a]">{requesterText(uiLanguage, "LIVE AI may be wrong and isn't medical care. For emergencies, call local services.")}<button type="button" aria-label={aiLanguageHelp.title} title={aiLanguageHelp.title} aria-expanded={aiLanguageHelpOpen} aria-controls="live-ai-language-help" onClick={() => setAiLanguageHelpOpen(true)} className="ml-1 inline-flex h-4 w-4 translate-y-[3px] items-center justify-center rounded-full text-[#0f6872] transition hover:bg-[#eef3f5] hover:text-[#0f5b67] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0f6872]"><CircleHelp className="h-3.5 w-3.5" /></button></p>
              </div>
            ) : currentQuestion ? <div className="shrink-0 border-t border-[#dce5ea] bg-white px-5 py-4 text-center text-xs leading-5 text-[#71838f]">{requesterText(uiLanguage, "Answer or skip the optional questions above to continue to LIVE AI chat.")}</div> : null}
          </motion.section>
          <AnimatePresence>
            {aiLanguageHelpOpen ? (
              <motion.div
                key="live-ai-language-help"
                className="absolute inset-0 z-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <button
                  type="button"
                  aria-label={aiLanguageHelp.closeLabel}
                  className="absolute inset-0 z-0 bg-[#071a29]/45"
                  onClick={() => setAiLanguageHelpOpen(false)}
                />
                <motion.aside
                  id="live-ai-language-help"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="live-ai-language-help-title"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 z-10 flex h-[100dvh] max-h-[100dvh] w-[90vw] flex-col overflow-y-auto bg-white shadow-2xl md:w-[min(28rem,calc(100vw-2rem))] md:rounded-l-2xl"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ type: "spring", stiffness: 330, damping: 34 }}
                >
                  <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dce5ea] px-5 py-4">
                    <h2 id="live-ai-language-help-title" className="font-semibold text-[#102b3f]">{aiLanguageHelp.title}</h2>
                    <Button data-live-ai-header-control type="button" variant="ghost" size="icon" aria-label={aiLanguageHelp.closeLabel} onClick={() => setAiLanguageHelpOpen(false)}>
                      <X className="h-5 w-5" />
                    </Button>
                  </header>
                  <div data-live-voice-focus-hint className="hidden shrink-0 items-center gap-2 border-b border-[#f1dfa9] bg-[#fff8df] px-5 py-2 text-xs font-semibold text-[#705400]">{requesterText(uiLanguage, 'Voice control is active. Say "next option", "previous option", "select", "button six", or "close".')}</div>
                  <div className="px-5 py-6">
                    <p className="text-sm leading-6 text-[#526a78]">{aiLanguageHelp.intro}</p>
                    <ul className="mt-4 flex flex-wrap gap-2" aria-label={aiLanguageHelp.supportedLanguagesLabel}>
                      {AI_SUPPORTED_LANGUAGES.map((language) => (
                        <li key={language} className="rounded-full border border-[#dce5ea] bg-[#f1f5f7] px-3 py-2 text-sm font-semibold text-[#526a78]">{language}</li>
                      ))}
                    </ul>
                    <p className="mt-6 text-sm leading-6 text-[#526a78]">{aiLanguageHelp.note}</p>
                    <section className="mt-5 border-y border-[#dce5ea] py-4">
                      <h3 className="text-sm font-semibold text-[#102b3f]">{aiLanguageHelp.examplesTitle}</h3>
                      <ol className="mt-3 space-y-3">
                        {aiLanguageHelp.examples.map((example, index) => (
                          <li key={example} className="flex items-start gap-3 text-sm leading-6 text-[#526a78]">
                            <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e7f3f4] text-xs font-semibold text-[#0f6872]">{index + 1}</span>
                            <span>{example}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </motion.aside>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
