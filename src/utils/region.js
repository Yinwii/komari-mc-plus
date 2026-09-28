// 国家 / 地区 / 主要机房城市别名 -> ISO 3166-1 alpha-2 代码。
// 说明：Komari 节点的分组名由用户自由填写，因此这里同时收录
//   1) 中文国家名、2) 英文国家名、3) 两位代码、4) 常见机房城市名。
const REGION_ALIASES = {
  // 中国大陆及周边
  china: "CN", 中国: "CN", 中国大陆: "CN", 大陆: "CN", cn: "CN", prc: "CN",
  japan: "JP", 日本: "JP", jp: "JP", jpn: "JP", 东京: "JP", 大阪: "JP", 名古屋: "JP", tokyo: "JP", osaka: "JP",
  usa: "US", america: "US", 美国: "US", us: "US", "united states": "US", "united states of america": "US",
  洛杉矶: "US", 圣何塞: "US", 圣克拉拉: "US", 硅谷: "US", 纽约: "US", 西雅图: "US", 芝加哥: "US",
  达拉斯: "US", 迈阿密: "US", 凤凰城: "US", 盐湖城: "US", 休斯顿: "US", 亚特兰大: "US", 丹佛: "US",
  波士顿: "US", 华盛顿: "US", 波特兰: "US", 拉斯维加斯: "US", 加州: "US", 弗吉尼亚: "US", 新泽西: "US",
  堪萨斯: "US", 密苏里: "US", 圣路易斯: "US", 阿什本: "US",
  "los angeles": "US", "san jose": "US", "san francisco": "US", "new york": "US", seattle: "US",
  dallas: "US", chicago: "US", miami: "US", phoenix: "US", atlanta: "US", denver: "US", ashburn: "US",
  hongkong: "HK", "hong kong": "HK", 香港: "HK", hk: "HK", hkg: "HK",
  taiwan: "TW", 台湾: "TW", 中國台灣: "TW", 中国台湾: "TW", tw: "TW", 台北: "TW", 高雄: "TW",
  macao: "MO", macau: "MO", 澳门: "MO", 澳門: "MO", mo: "MO",
  singapore: "SG", 新加坡: "SG", sg: "SG", 狮城: "SG",

  // 亚洲其他
  korea: "KR", "south korea": "KR", 韩国: "KR", 韓國: "KR", kr: "KR", kor: "KR", 首尔: "KR", 首爾: "KR", 春川: "KR", seoul: "KR",
  malaysia: "MY", 马来西亚: "MY", 馬來西亞: "MY", my: "MY", 吉隆坡: "MY", "kuala lumpur": "MY",
  thailand: "TH", 泰国: "TH", 泰國: "TH", th: "TH", 曼谷: "TH", bangkok: "TH",
  vietnam: "VN", 越南: "VN", vn: "VN", 河内: "VN", 胡志明: "VN", hanoi: "VN",
  philippines: "PH", 菲律宾: "PH", 菲律賓: "PH", ph: "PH", 马尼拉: "PH", manila: "PH",
  indonesia: "ID", 印尼: "ID", 印度尼西亚: "ID", id: "ID", 雅加达: "ID", jakarta: "ID",
  india: "IN", 印度: "IN", in: "IN", 孟买: "IN", 班加罗尔: "IN", mumbai: "IN",
  "united arab emirates": "AE", uae: "AE", 阿联酋: "AE", 阿聯酋: "AE", ae: "AE", 迪拜: "AE", dubai: "AE",
  saudi: "SA", "saudi arabia": "SA", 沙特: "SA", 沙特阿拉伯: "SA", sa: "SA", 利雅得: "SA",
  turkey: "TR", türkiye: "TR", 土耳其: "TR", tr: "TR", 伊斯坦布尔: "TR", istanbul: "TR",
  israel: "IL", 以色列: "IL", il: "IL", 特拉维夫: "IL", "tel aviv": "IL",
  pakistan: "PK", 巴基斯坦: "PK", pk: "PK",
  bangladesh: "BD", 孟加拉: "BD", bd: "BD",
  kazakhstan: "KZ", 哈萨克斯坦: "KZ", kz: "KZ", 阿拉木图: "KZ",
  mongolia: "MN", 蒙古: "MN", mn: "MN",
  nepal: "NP", 尼泊尔: "NP", np: "NP",
  srilanka: "LK", "sri lanka": "LK", 斯里兰卡: "LK", lk: "LK",
  cambodia: "KH", 柬埔寨: "KH", kh: "KH",
  laos: "LA", 老挝: "LA", la: "LA",
  myanmar: "MM", 缅甸: "MM", mm: "MM",

  // 欧洲
  "united kingdom": "GB", uk: "GB", britain: "GB", "great britain": "GB", england: "GB", gb: "GB",
  英国: "GB", 英國: "GB", 伦敦: "GB", 倫敦: "GB", london: "GB", 曼彻斯特: "GB", manchester: "GB",
  germany: "DE", 德国: "DE", 德國: "DE", de: "DE", 法兰克福: "DE", 法蘭克福: "DE", frankfurt: "DE",
  柏林: "DE", berlin: "DE", 纽伦堡: "DE", 慕尼黑: "DE",
  france: "FR", 法国: "FR", 法國: "FR", fr: "FR", 巴黎: "FR", paris: "FR", 马赛: "FR",
  netherlands: "NL", holland: "NL", 荷兰: "NL", 荷蘭: "NL", nl: "NL", 阿姆斯特丹: "NL", amsterdam: "NL",
  russia: "RU", 俄罗斯: "RU", 俄羅斯: "RU", ru: "RU", 莫斯科: "RU", moscow: "RU", 圣彼得堡: "RU",
  italy: "IT", 意大利: "IT", it: "IT", 米兰: "IT", milan: "IT", 罗马: "IT",
  spain: "ES", 西班牙: "ES", es: "ES", 马德里: "ES", madrid: "ES", 巴塞罗那: "ES",
  portugal: "PT", 葡萄牙: "PT", pt: "PT", 里斯本: "PT",
  ireland: "IE", 爱尔兰: "IE", ie: "IE", 都柏林: "IE", dublin: "IE",
  switzerland: "CH", 瑞士: "CH", ch: "CH", 苏黎世: "CH", zurich: "CH", 日内瓦: "CH",
  austria: "AT", 奥地利: "AT", at: "AT", 维也纳: "AT", vienna: "AT",
  belgium: "BE", 比利时: "BE", be: "BE", 布鲁塞尔: "BE", brussels: "BE",
  sweden: "SE", 瑞典: "SE", se: "SE", 斯德哥尔摩: "SE", stockholm: "SE",
  norway: "NO", 挪威: "NO", no: "NO", 奥斯陆: "NO", oslo: "NO",
  finland: "FI", 芬兰: "FI", fi: "FI", 赫尔辛基: "FI", helsinki: "FI",
  denmark: "DK", 丹麦: "DK", dk: "DK", 哥本哈根: "DK", copenhagen: "DK",
  poland: "PL", 波兰: "PL", pl: "PL", 华沙: "PL", warsaw: "PL",
  czech: "CZ", "czech republic": "CZ", czechia: "CZ", 捷克: "CZ", cz: "CZ", 布拉格: "CZ", prague: "CZ",
  hungary: "HU", 匈牙利: "HU", hu: "HU", 布达佩斯: "HU", budapest: "HU",
  romania: "RO", 罗马尼亚: "RO", ro: "RO", 布加勒斯特: "RO", bucharest: "RO",
  bulgaria: "BG", 保加利亚: "BG", bg: "BG", 索菲亚: "BG",
  greece: "GR", 希腊: "GR", gr: "GR", 雅典: "GR",
  ukraine: "UA", 乌克兰: "UA", ua: "UA", 基辅: "UA", kyiv: "UA",
  lithuania: "LT", 立陶宛: "LT", lt: "LT",
  latvia: "LV", 拉脱维亚: "LV", lv: "LV",
  estonia: "EE", 爱沙尼亚: "EE", ee: "EE",
  iceland: "IS", 冰岛: "IS", is: "IS",
  luxembourg: "LU", 卢森堡: "LU", lu: "LU",
  serbia: "RS", 塞尔维亚: "RS", rs: "RS",
  croatia: "HR", 克罗地亚: "HR", hr: "HR",
  slovakia: "SK", 斯洛伐克: "SK", sk: "SK",
  slovenia: "SI", 斯洛文尼亚: "SI", si: "SI",
  moldova: "MD", 摩尔多瓦: "MD", md: "MD",
  cyprus: "CY", 塞浦路斯: "CY", cy: "CY",
  malta: "MT", 马耳他: "MT", mt: "MT",
  albania: "AL", 阿尔巴尼亚: "AL", al: "AL",

  // 美洲
  canada: "CA", 加拿大: "CA", ca: "CA", 多伦多: "CA", 多倫多: "CA", toronto: "CA",
  温哥华: "CA", 溫哥華: "CA", vancouver: "CA", 蒙特利尔: "CA", montreal: "CA", 魁北克: "CA",
  mexico: "MX", 墨西哥: "MX", mx: "MX", 墨西哥城: "MX",
  brazil: "BR", 巴西: "BR", br: "BR", 圣保罗: "BR", "são paulo": "BR", "sao paulo": "BR",
  argentina: "AR", 阿根廷: "AR", ar: "AR", 布宜诺斯艾利斯: "AR",
  chile: "CL", 智利: "CL", cl: "CL", 圣地亚哥: "CL",
  colombia: "CO", 哥伦比亚: "CO", co: "CO", 波哥大: "CO",
  peru: "PE", 秘鲁: "PE", pe: "PE",
  venezuela: "VE", 委内瑞拉: "VE", ve: "VE",
  ecuador: "EC", 厄瓜多尔: "EC", ec: "EC",
  uruguay: "UY", 乌拉圭: "UY", uy: "UY",
  panama: "PA", 巴拿马: "PA", pa: "PA",
  "costa rica": "CR", 哥斯达黎加: "CR", cr: "CR",

  // 大洋洲与非洲
  australia: "AU", 澳大利亚: "AU", 澳洲: "AU", au: "AU", 悉尼: "AU", sydney: "AU",
  墨尔本: "AU", melbourne: "AU", 布里斯班: "AU", brisbane: "AU", 珀斯: "AU", perth: "AU",
  "new zealand": "NZ", 新西兰: "NZ", nz: "NZ", 奥克兰: "NZ", auckland: "NZ",
  "south africa": "ZA", 南非: "ZA", za: "ZA", 约翰内斯堡: "ZA", johannesburg: "ZA",
  egypt: "EG", 埃及: "EG", eg: "EG", 开罗: "EG", cairo: "EG",
  nigeria: "NG", 尼日利亚: "NG", ng: "NG", 拉各斯: "NG", lagos: "NG",
  kenya: "KE", 肯尼亚: "KE", ke: "KE", 内罗毕: "KE",
  morocco: "MA", 摩洛哥: "MA", ma: "MA",
  tunisia: "TN", 突尼斯: "TN", tn: "TN",
  mauritius: "MU", 毛里求斯: "MU", mu: "MU",
  madagascar: "MG", 马达加斯加: "MG", mg: "MG",
  ghana: "GH", 加纳: "GH", gh: "GH",
  ethiopia: "ET", 埃塞俄比亚: "ET", et: "ET",
};

const REGION_NAMES = {
  CN: "中国", JP: "日本", US: "美国", HK: "中国香港", TW: "中国台湾", MO: "中国澳门",
  SG: "新加坡", KR: "韩国", MY: "马来西亚", TH: "泰国", VN: "越南", PH: "菲律宾", ID: "印度尼西亚",
  IN: "印度", AE: "阿联酋", SA: "沙特阿拉伯", TR: "土耳其", IL: "以色列", PK: "巴基斯坦",
  KZ: "哈萨克斯坦", MN: "蒙古", NP: "尼泊尔", LK: "斯里兰卡", KH: "柬埔寨", LA: "老挝", MM: "缅甸",
  GB: "英国", DE: "德国", FR: "法国", NL: "荷兰", RU: "俄罗斯", IT: "意大利", ES: "西班牙",
  PT: "葡萄牙", IE: "爱尔兰", CH: "瑞士", AT: "奥地利", BE: "比利时", SE: "瑞典", NO: "挪威",
  FI: "芬兰", DK: "丹麦", PL: "波兰", CZ: "捷克", HU: "匈牙利", RO: "罗马尼亚", BG: "保加利亚",
  GR: "希腊", UA: "乌克兰", LT: "立陶宛", LV: "拉脱维亚", EE: "爱沙尼亚", IS: "冰岛",
  LU: "卢森堡", RS: "塞尔维亚", HR: "克罗地亚", SK: "斯洛伐克", SI: "斯洛文尼亚", MD: "摩尔多瓦",
  CY: "塞浦路斯", MT: "马耳他", AL: "阿尔巴尼亚",
  CA: "加拿大", MX: "墨西哥", BR: "巴西", AR: "阿根廷", CL: "智利", CO: "哥伦比亚", PE: "秘鲁",
  VE: "委内瑞拉", EC: "厄瓜多尔", UY: "乌拉圭", PA: "巴拿马", CR: "哥斯达黎加",
  AU: "澳大利亚", NZ: "新西兰", ZA: "南非", EG: "埃及", NG: "尼日利亚", KE: "肯尼亚",
  MA: "摩洛哥", TN: "突尼斯", MU: "毛里求斯", MG: "马达加斯加", GH: "加纳", ET: "埃塞俄比亚",
};

// 只在对象自有属性中查找，避免 constructor / toString 之类的原型成员被误判成国家代码。
function lookupAlias(value) {
  if (!value) return "";
  const key = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(REGION_ALIASES, key) ? REGION_ALIASES[key] : "";
}

// 从字符串中提取国旗 emoji 对应的国家代码，如 "🇭🇰 香港" -> HK。
function codeFromEmoji(value) {
  const indicators = Array.from(value).filter((char) => {
    const point = char.codePointAt(0);
    return point >= 0x1f1e6 && point <= 0x1f1ff;
  });
  if (indicators.length < 2) return "";
  return indicators
    .slice(0, 2)
    .map((char) => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 65))
    .join("");
}

function isTwoLetterCode(value) {
  return /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : "";
}

export function getRegionCode(region) {
  const value = String(region || "").trim();
  if (!value) return "";

  const full = lookupAlias(value);
  if (full) return full;

  const emoji = codeFromEmoji(value);
  if (emoji) return emoji;

  const code = isTwoLetterCode(value);
  if (code) return code;

  // 复合分组名，如 "美国-洛杉矶"、"JP 东京"、"香港 CMI"、"US | San Jose"：逐段匹配。
  const tokens = value.split(/[\s\-_·|/,、+&()（）[\]【】:：;；.。]+/).filter(Boolean);
  if (tokens.length > 1) {
    for (const token of tokens) {
      const hit = lookupAlias(token) || isTwoLetterCode(token);
      if (hit) return hit;
    }
  }

  // 形如 "US01"、"jp-1" 的两位代码前缀（后一个字符必须是数字或空白，避免 "Osaka" 被误判）。
  const prefix = value.match(/^([a-z]{2})(?=[\d\s]|$)/i);
  if (prefix) return prefix[1].toUpperCase();

  return "";
}

export function hasRegion(region) { return Boolean(String(region || "").trim()); }
export function getFlagImage(region) { const code = getRegionCode(region); return code ? `/assets/flags/${code}.svg` : null; }
export function getRegionEmoji(region) {
  const code = getRegionCode(region);
  if (!code) return "";
  return String.fromCodePoint(...code.split("").map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}
export function getRegionDisplayName(region) { const code = getRegionCode(region); return REGION_NAMES[code] || code || String(region || "").trim(); }
