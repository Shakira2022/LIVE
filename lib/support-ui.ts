import type { RequesterLanguage } from "@/lib/requester-language";

const SUPPORT_TRANSLATIONS: Partial<Record<RequesterLanguage, Record<string, string>>> = {
  Afrikaans: {
    "Contact support": "Kontak ondersteuning", "Choose what you need help with and tell us what happened.": "Kies waarmee jy hulp nodig het en vertel ons wat gebeur het.",
    "What do you need help with?": "Waarmee het jy hulp nodig?", "Tell us more": "Vertel ons meer", "Describe what happened and what you were trying to do.": "Beskryf wat gebeur het en wat jy probeer doen het.",
    "Send to support": "Stuur aan ondersteuning", "Your message has been sent": "Jou boodskap is gestuur", "The LIVE support team has received your request.": "Die LIVE-ondersteuningspan het jou versoek ontvang.", "Send another message": "Stuur nog 'n boodskap",
    "Account access": "Rekeningtoegang", "Profile or account details": "Profiel- of rekeningbesonderhede", "Request or incident": "Versoek of voorval", "Map or location": "Kaart of ligging", "Calls or notifications": "Oproepe of kennisgewings", "Technical problem": "Tegniese probleem", Other: "Ander",
  },
  isiZulu: {
    "Contact support": "Xhumana nethimba losizo", "Choose what you need help with and tell us what happened.": "Khetha odinga usizo ngakho bese usitshela okwenzekile.",
    "What do you need help with?": "Udinga usizo ngani?", "Tell us more": "Sitshele okwengeziwe", "Describe what happened and what you were trying to do.": "Chaza okwenzekile nokuthi ubuzama ukwenzani.",
    "Send to support": "Thumela ethimbeni losizo", "Your message has been sent": "Umlayezo wakho uthunyelwe", "The LIVE support team has received your request.": "Ithimba losizo le-LIVE lithole isicelo sakho.", "Send another message": "Thumela omunye umlayezo",
    "Account access": "Ukungena ku-akhawunti", "Profile or account details": "Imininingwane yephrofayela noma ye-akhawunti", "Request or incident": "Isicelo noma isigameko", "Map or location": "Imephu noma indawo", "Calls or notifications": "Izingcingo noma izaziso", "Technical problem": "Inkinga yobuchwepheshe", Other: "Okunye",
  },
  isiXhosa: {
    "Contact support": "Qhagamshelana nenkxaso", "Choose what you need help with and tell us what happened.": "Khetha into ofuna uncedo ngayo uze usixelele okwenzekileyo.",
    "What do you need help with?": "Ufuna uncedo ngantoni?", "Tell us more": "Sixelele ngakumbi", "Describe what happened and what you were trying to do.": "Chaza okwenzekileyo noko ubuzama ukukwenza.",
    "Send to support": "Thumela kwinkxaso", "Your message has been sent": "Umyalezo wakho uthunyelwe", "The LIVE support team has received your request.": "Iqela lenkxaso le-LIVE lifumene isicelo sakho.", "Send another message": "Thumela omnye umyalezo",
    "Account access": "Ukufikelela kwiakhawunti", "Profile or account details": "Iinkcukacha zeprofayile okanye zeakhawunti", "Request or incident": "Isicelo okanye isiganeko", "Map or location": "Imephu okanye indawo", "Calls or notifications": "Iminxeba okanye izaziso", "Technical problem": "Ingxaki yobugcisa", Other: "Okunye",
  },
  Sesotho: {
    "Contact support": "Ikopanye le tshehetso", "Choose what you need help with and tell us what happened.": "Khetha seo o hlokang thuso ka sona mme o re bolelle se etsahetseng.",
    "What do you need help with?": "O hloka thuso ka eng?", "Tell us more": "Re bolelle haholoanyane", "Describe what happened and what you were trying to do.": "Hlalosa se etsahetseng le seo o neng o leka ho se etsa.",
    "Send to support": "Romela ho tshehetso", "Your message has been sent": "Molaetsa wa hao o rometswe", "The LIVE support team has received your request.": "Sehlopha sa tshehetso sa LIVE se amohetse kopo ya hao.", "Send another message": "Romela molaetsa o mong",
    "Account access": "Ho kena akhaonteng", "Profile or account details": "Dintlha tsa profaele kapa akhaonte", "Request or incident": "Kopo kapa ketsahalo", "Map or location": "Mmapa kapa sebaka", "Calls or notifications": "Mehala kapa ditsebiso", "Technical problem": "Bothata ba theknoloji", Other: "Tse ding",
  },
  Setswana: {
    "Contact support": "Ikgolaganye le thuso", "Choose what you need help with and tell us what happened.": "Tlhopha se o tlhokang thuso ka sona mme o re bolelele se se diragetseng.",
    "What do you need help with?": "O tlhoka thuso ka eng?", "Tell us more": "Re bolelele go le gontsi", "Describe what happened and what you were trying to do.": "Tlhalosa se se diragetseng le se o neng o leka go se dira.",
    "Send to support": "Romela kwa thusong", "Your message has been sent": "Molaetsa wa gago o rometswe", "The LIVE support team has received your request.": "Setlhopha sa thuso sa LIVE se amogetse kopo ya gago.", "Send another message": "Romela molaetsa o mongwe",
    "Account access": "Go tsena mo akhaontong", "Profile or account details": "Dintlha tsa profaele kgotsa akhaonto", "Request or incident": "Kopo kgotsa tiragalo", "Map or location": "Mmepe kgotsa lefelo", "Calls or notifications": "Megala kgotsa dikitsiso", "Technical problem": "Bothata jwa setegeniki", Other: "Tse dingwe",
  },
  Sepedi: {
    "Contact support": "Ikgokaganye le thekgo", "Choose what you need help with and tell us what happened.": "Kgetha seo o nyakago thušo ka sona gomme o re botše seo se diregilego.",
    "What do you need help with?": "O nyaka thušo ka eng?", "Tell us more": "Re botše ka botlalo", "Describe what happened and what you were trying to do.": "Hlalosa seo se diregilego le seo o bego o leka go se dira.",
    "Send to support": "Romela go thekgo", "Your message has been sent": "Molaetša wa gago o rometšwe", "The LIVE support team has received your request.": "Sehlopha sa thekgo sa LIVE se amogetše kgopelo ya gago.", "Send another message": "Romela molaetša o mongwe",
    "Account access": "Go tsena akhaontong", "Profile or account details": "Dintlha tša profaele goba akhaonto", "Request or incident": "Kgopelo goba tiragalo", "Map or location": "Mmapa goba lefelo", "Calls or notifications": "Megala goba ditsebišo", "Technical problem": "Bothata bja theknolotši", Other: "Tše dingwe",
  },
  siSwati: {
    "Contact support": "Thintana nelusito", "Choose what you need help with and tell us what happened.": "Khetsa loko udzinga lusito khona bese usitjela lokwentekile.",
    "What do you need help with?": "Udzinga lusito ngani?", "Tell us more": "Sitjele kabanti", "Describe what happened and what you were trying to do.": "Chaza lokwentekile naloko bewetama kukwenta.",
    "Send to support": "Tfumela elusitweni", "Your message has been sent": "Umlayeto wakho utfunyelwe", "The LIVE support team has received your request.": "Licembu le-LIVE lel lusito selisamukele sicelo sakho.", "Send another message": "Tfumela lomunye umlayeto",
    "Account access": "Kungena ku-akhawunti", "Profile or account details": "Imininingwane yephrofayela noma ye-akhawunti", "Request or incident": "Sicelo noma sehlakalo", "Map or location": "Imephu noma indzawo", "Calls or notifications": "Tingcingo noma tatiso", "Technical problem": "Inkinga yetebuchwepheshe", Other: "Lokunye",
  },
  Tshivenda: {
    "Contact support": "Vhudzani thuso", "Choose what you need help with and tell us what happened.": "Nangani zwine na ṱoḓa thuso ngazwo ni ri vhudze zwe zwa itea.",
    "What do you need help with?": "Ni ṱoḓa thuso nga mini?", "Tell us more": "Ri vhudzeni zwinzhi", "Describe what happened and what you were trying to do.": "Ṱalutshedzani zwe zwa itea na zwe na vha ni tshi khou lingedza u ita.",
    "Send to support": "Rumelani kha thuso", "Your message has been sent": "Mulaedza waṋu wo rumelwa", "The LIVE support team has received your request.": "Tshigwada tsha thuso tsha LIVE tsho wana khumbelo yaṋu.", "Send another message": "Rumelani muṅwe mulaedza",
    "Account access": "U dzhena kha akhaunthu", "Profile or account details": "Vhuṱanzi ha phurofaili kana akhaunthu", "Request or incident": "Khumbelo kana tshiwo", "Map or location": "Mapa kana fhethu", "Calls or notifications": "Mifoni kana nḓivhadzo", "Technical problem": "Thaidzo ya thekinolodzhi", Other: "Zwiṅwe",
  },
  isiNdebele: {
    "Contact support": "Thintana nesekelo", "Choose what you need help with and tell us what happened.": "Khetha lokufuna ukusizwa ngakho bese usitjela okwenzekile.",
    "What do you need help with?": "Ufuna ukusizwa ngani?", "Tell us more": "Sitjele okunengi", "Describe what happened and what you were trying to do.": "Hlathulula okwenzekile nalokho obuzama ukukwenza.",
    "Send to support": "Thumela esekelweni", "Your message has been sent": "Umlayezo wakho uthunyelwe", "The LIVE support team has received your request.": "Ithimba le-LIVE litholile isibawo sakho.", "Send another message": "Thumela omunye umlayezo",
    "Account access": "Ukungena ku-akhawunti", "Profile or account details": "Imininingwana yephrofayili namkha ye-akhawunti", "Request or incident": "Isibawo namkha isehlakalo", "Map or location": "Imephu namkha indawo", "Calls or notifications": "Iminxeba namkha izaziso", "Technical problem": "Umraro wezobuchwepheshe", Other: "Okhunye",
  },
  XiTsonga: {
    "Contact support": "Tihlanganise na nseketelo", "Choose what you need help with and tell us what happened.": "Hlawula leswi u lavaka mpfuno ha swona u hi byele leswi humeleleke.",
    "What do you need help with?": "U lava mpfuno hi yini?", "Tell us more": "Hi byele swo tala", "Describe what happened and what you were trying to do.": "Hlamusela leswi humeleleke ni leswi a wu ringeta ku swi endla.",
    "Send to support": "Rhumela eka nseketelo", "Your message has been sent": "Mahungu ya wena ma rhumeriwile", "The LIVE support team has received your request.": "Nseketelo wa LIVE wu amukerile xikombelo xa wena.", "Send another message": "Rhumela mahungu man'wana",
    "Account access": "Ku nghena eka akhawunti", "Profile or account details": "Vuxokoxoko bya profayili kumbe akhawunti", "Request or incident": "Xikombelo kumbe xiendlakalo", "Map or location": "Mepe kumbe ndhawu", "Calls or notifications": "Mafoni kumbe switiviso", "Technical problem": "Xiphiqo xa thekinoloji", Other: "Swin'wana",
  },
};

export function supportText(language: RequesterLanguage, text: string) {
  return SUPPORT_TRANSLATIONS[language]?.[text] ?? text;
}
