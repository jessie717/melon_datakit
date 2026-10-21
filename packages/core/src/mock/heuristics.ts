/**
 * 字段名启发式 —— 根据字段名猜测「像什么数据」，比随机串更贴近真实。
 *
 * 只处理 type 兼容的匹配（字符串启发式不干扰数字字段），
 * 未命中一律回落到 schema 生成。
 */

export type FakerLike = {
  person: {
    fullName(): string;
    firstName(): string;
    lastName(): string;
    jobTitle(): string;
  };
  internet: {
    email(): string;
    url(): string;
    domainName(): string;
    ipv4(): string;
  };
  phone: { number(): string };
  location: {
    streetAddress(): string;
    city(): string;
    country(): string;
    zipCode(): string;
  };
  company: { name(): string };
  word: { words(count: number): string };
  string: { uuid(): string; alphanumeric(len: number): string };
  datatype: { boolean(): boolean };
  date: { recent(): Date };
  commerce: { price(): string };
  number: {
    int(opts: { min: number; max: number }): number;
    float(opts: { min: number; max: number; maxFractionDigits?: number }): number;
  };
};

const zhSentence = (faker: FakerLike, words = 8): string =>
  `${faker.word.words(words).replace(/ /g, '')}。`;

/** 启发式条目：字段名正则 + 类型约束 + 生成 */
interface Heuristic {
  re: RegExp;
  types: Array<'string' | 'number' | 'integer' | 'boolean'>;
  gen: (faker: FakerLike) => unknown;
}

/** 顺序即优先级 —— 越具体越靠前 */
const HEURISTICS: Heuristic[] = [
  // —— 字符串 ——
  { re: /(^|_)(first_?name|firstName)$|^firstName$/i, types: ['string'], gen: (f) => f.person.firstName() },
  { re: /(^|_)(last_?name|lastName)$|^lastName$/i, types: ['string'], gen: (f) => f.person.lastName() },
  { re: /(name|username|nickname|real_?name|author|creator|contact_?person|owner)$/i, types: ['string'], gen: (f) => f.person.fullName() },
  { re: /e-?mail/i, types: ['string'], gen: (f) => f.internet.email() },
  { re: /(phone|mobile|tel|telephone|fax)/i, types: ['string'], gen: (f) => f.phone.number() },
  { re: /zip|postal|postcode/i, types: ['string'], gen: (f) => f.location.zipCode() },
  { re: /address|addr/i, types: ['string'], gen: (f) => f.location.streetAddress() },
  { re: /city/i, types: ['string'], gen: (f) => f.location.city() },
  { re: /country/i, types: ['string'], gen: (f) => f.location.country() },
  { re: /company|org(ani[sz]ation)?|corp/i, types: ['string'], gen: (f) => f.company.name() },
  { re: /(^id$|uuid|guid)/i, types: ['string'], gen: (f) => f.string.uuid() },
  { re: /(code|sku|sn|serial|no$|number$|order_?no|trade_?no)/i, types: ['string'], gen: (f) => f.string.alphanumeric(8).toUpperCase() },
  { re: /url|avatar|image|img|pic|photo|logo/i, types: ['string'], gen: (f) => f.internet.url() },
  { re: /domain/i, types: ['string'], gen: (f) => f.internet.domainName() },
  // ip 必须是独立段 —— 防止误匹配 description 里的 "ip"
  // snake/kebab/全词形式（大小写不敏感）
  { re: /(^|[_-])ip([_-]|$)/i, types: ['string'], gen: (f) => f.internet.ipv4() },
  // 驼峰形式（必须大小写敏感，否则 description 里的 ip 会被误命中）
  { re: /^ip[A-Z]|[a-z]Ip($|[A-Z])/, types: ['string'], gen: (f) => f.internet.ipv4() },
  { re: /(created_?at|updated_?at|deleted_?at|modified|published|published_?at|timestamp$)/i, types: ['string'], gen: (f) => f.date.recent().toISOString() },
  { re: /(^date$|birthday|birth|deadline|day$)/i, types: ['string'], gen: (f) => f.date.recent().toISOString().slice(0, 10) },
  { re: /(desc|description|summary|remark|comment|content|text|reason|note|bio|intro)/i, types: ['string'], gen: (f) => zhSentence(f) },
  { re: /(title|subject|heading|label|tag|keyword)/i, types: ['string'], gen: (f) => f.word.words(3) },

  // —— 数字 ——
  { re: /(price|amount|salary|cost|fee|money|total_?price|pay)/i, types: ['number', 'integer'], gen: (f) => Number(f.commerce.price()) },
  { re: /^age$/i, types: ['number', 'integer'], gen: (f) => f.number.int({ min: 18, max: 65 }) },
  // 分页字段要有真实感（page: 1~10，pageSize: 10/20/50）
  { re: /^(page|page_?no|page_?index|offset)$/i, types: ['number', 'integer'], gen: (f) => f.number.int({ min: 1, max: 10 }) },
  { re: /^(page_?size|per_?page|limit|size)$/i, types: ['number', 'integer'], gen: (f) => [10, 20, 50, 100][f.number.int({ min: 0, max: 3 })] },
  { re: /(count|total|qty|quantity|num|length|stock|inventory)/i, types: ['number', 'integer'], gen: (f) => f.number.int({ min: 0, max: 999 }) },
  { re: /(score|rate|ratio|percent|progress)/i, types: ['number', 'integer'], gen: (f) => f.number.float({ min: 0, max: 100, maxFractionDigits: 2 }) },
  { re: /version/i, types: ['number', 'integer'], gen: (f) => f.number.int({ min: 1, max: 20 }) },
  { re: /(lat|lng|lon|latitude|longitude)/i, types: ['number'], gen: (f) => f.number.float({ min: -180, max: 180, maxFractionDigits: 6 }) },

  // —— 布尔 ——
  { re: /(enable|enabled|active|visible|deleted|valid|success|has_?)/i, types: ['boolean'], gen: (f) => f.datatype.boolean() },
];

/**
 * 返回 undefined 表示未命中，由调用方回落。
 * seed 不在这里消费 —— 调用方负责先 faker.seed(fieldSeed)。
 */
export function heuristicValue(
  faker: FakerLike,
  fieldName: string,
  type: string
): unknown {
  for (const h of HEURISTICS) {
    if (!h.types.includes(type as 'string')) continue;
    if (h.re.test(fieldName)) return h.gen(faker);
  }
  return undefined;
}

/** 中文句子（description 类通用） */
export const zhWordsSentence = zhSentence;
