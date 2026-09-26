/**
 * National-teams registry for the נבחרות (national teams) mode.
 *
 * Mirrors lib/teams.ts (clubs): canonical English name, Hebrew display name,
 * English/Hebrew aliases. English aliases include the FIFA trigram code
 * (ISR, FRA, ENG …) because highlight titles very often use them
 * ("ISR vs FRA", "אוסטריה - ישראל 3:1" also appears with trigrams).
 *
 * The matcher treats a NationEntry exactly like a ClubEntry (same shape
 * minus nothing); nation-awareness is wired through lib/nationIndex.ts.
 */
export interface NationEntry {
  /** Canonical English name, e.g. "Republic of Ireland" */
  en: string;
  /** Hebrew display name, e.g. "אירלנד" */
  he: string;
  /** English aliases / FIFA trigram / spelling variants */
  enAliases: string[];
  /** Hebrew aliases / spelling variants */
  heAliases: string[];
  /**
   * Flag code for thumbnails (flagcdn.com), e.g. "il", "fr".
   * UK nations use "gb-eng" / "gb-sct" / "gb-wls" / "gb-nir"; Kosovo "xk".
   */
  iso: string;
}

export const NATIONS: NationEntry[] = [
  // ---------------------------------------------------------------- UEFA
  { en: 'Albania', he: 'אלבניה', enAliases: ['ALB'], heAliases: [], iso: 'al' },
  { en: 'Andorra', he: 'אנדורה', enAliases: ['AND'], heAliases: [], iso: 'ad' },
  { en: 'Armenia', he: 'ארמניה', enAliases: ['ARM'], heAliases: [], iso: 'am' },
  { en: 'Austria', he: 'אוסטריה', enAliases: ['AUT'], heAliases: [], iso: 'at' },
  { en: "Azerbaijan", he: 'אזרבייג׳ן', enAliases: ['AZE'], heAliases: ['אזרבייגן'], iso: 'az' },
  { en: 'Belarus', he: 'בלארוס', enAliases: ['BLR'], heAliases: [], iso: 'by' },
  { en: 'Belgium', he: 'בלגיה', enAliases: ['BEL'], heAliases: [], iso: 'be' },
  { en: 'Bosnia and Herzegovina', he: 'בוסניה והרצגובינה', enAliases: ['Bosnia', 'Bosnia-Herzegovina', 'BIH'], heAliases: ['בוסניה'], iso: 'ba' },
  { en: 'Bulgaria', he: 'בולגריה', enAliases: ['BUL'], heAliases: [], iso: 'bg' },
  { en: 'Croatia', he: 'קרואטיה', enAliases: ['CRO'], heAliases: [], iso: 'hr' },
  { en: 'Cyprus', he: 'קפריסין', enAliases: ['CYP'], heAliases: [], iso: 'cy' },
  { en: 'Czechia', he: 'צ׳כיה', enAliases: ['Czech Republic', 'CZE'], heAliases: ['צכיה'], iso: 'cz' },
  { en: 'Denmark', he: 'דנמרק', enAliases: ['DEN'], heAliases: [], iso: 'dk' },
  { en: 'England', he: 'אנגליה', enAliases: ['ENG'], heAliases: [], iso: 'gb-eng' },
  { en: 'Estonia', he: 'אסטוניה', enAliases: ['EST'], heAliases: [], iso: 'ee' },
  { en: 'Faroe Islands', he: 'איי פארו', enAliases: ['Faroe', 'FRO'], heAliases: [], iso: 'fo' },
  { en: 'Finland', he: 'פינלנד', enAliases: ['FIN'], heAliases: [], iso: 'fi' },
  { en: 'France', he: 'צרפת', enAliases: ['FRA'], heAliases: [], iso: 'fr' },
  { en: 'Georgia', he: 'גאורגיה', enAliases: ['GEO'], heAliases: [], iso: 'ge' },
  { en: 'Germany', he: 'גרמניה', enAliases: ['GER'], heAliases: [], iso: 'de' },
  { en: 'Gibraltar', he: 'גיברלטר', enAliases: ['GIB'], heAliases: [], iso: 'gi' },
  { en: 'Greece', he: 'יוון', enAliases: ['GRE'], heAliases: [], iso: 'gr' },
  { en: 'Hungary', he: 'הונגריה', enAliases: ['HUN'], heAliases: [], iso: 'hu' },
  { en: 'Iceland', he: 'איסלנד', enAliases: ['ISL'], heAliases: [], iso: 'is' },
  { en: 'Israel', he: 'ישראל', enAliases: ['ISR'], heAliases: [], iso: 'il' },
  { en: 'Italy', he: 'איטליה', enAliases: ['ITA'], heAliases: [], iso: 'it' },
  { en: 'Kazakhstan', he: 'קזחסטן', enAliases: ['KAZ'], heAliases: [], iso: 'kz' },
  { en: 'Kosovo', he: 'קוסובו', enAliases: ['KOS'], heAliases: [], iso: 'xk' },
  { en: 'Latvia', he: 'לטביה', enAliases: ['LVA'], heAliases: [], iso: 'lv' },
  { en: 'Liechtenstein', he: 'ליכטנשטיין', enAliases: ['LIE'], heAliases: [], iso: 'li' },
  { en: 'Lithuania', he: 'ליטא', enAliases: ['LTU'], heAliases: [], iso: 'lt' },
  { en: 'Luxembourg', he: 'לוקסמבורג', enAliases: ['LUX'], heAliases: [], iso: 'lu' },
  { en: 'Malta', he: 'מלטה', enAliases: ['MLT'], heAliases: [], iso: 'mt' },
  { en: 'Moldova', he: 'מולדובה', enAliases: ['Moldavia', 'MDA'], heAliases: [], iso: 'md' },
  { en: 'Montenegro', he: 'מונטנגרו', enAliases: ['MNE'], heAliases: [], iso: 'me' },
  { en: 'Netherlands', he: 'הולנד', enAliases: ['Holland', 'NED'], heAliases: [], iso: 'nl' },
  { en: 'North Macedonia', he: 'צפון מקדוניה', enAliases: ['Macedonia', 'MKD'], heAliases: ['מקדוניה'], iso: 'mk' },
  { en: 'Northern Ireland', he: 'צפון אירלנד', enAliases: ['NIR'], heAliases: [], iso: 'gb-nir' },
  { en: 'Norway', he: 'נורווגיה', enAliases: ['NOR'], heAliases: [], iso: 'no' },
  { en: 'Poland', he: 'פולין', enAliases: ['POL'], heAliases: [], iso: 'pl' },
  { en: 'Portugal', he: 'פורטוגל', enAliases: ['POR'], heAliases: [], iso: 'pt' },
  { en: 'Republic of Ireland', he: 'אירלנד', enAliases: ['Ireland', 'IRL', 'ROI'], heAliases: [], iso: 'ie' },
  { en: 'Romania', he: 'רומניה', enAliases: ['ROU'], heAliases: [], iso: 'ro' },
  { en: 'Russia', he: 'רוסיה', enAliases: ['RUS'], heAliases: [], iso: 'ru' },
  { en: 'San Marino', he: 'סן מרינו', enAliases: ['SMR'], heAliases: [], iso: 'sm' },
  { en: 'Scotland', he: 'סקוטלנד', enAliases: ['SCO'], heAliases: [], iso: 'gb-sct' },
  { en: 'Serbia', he: 'סרביה', enAliases: ['SRB'], heAliases: [], iso: 'rs' },
  { en: 'Slovakia', he: 'סלובקיה', enAliases: ['SVK'], heAliases: [], iso: 'sk' },
  { en: 'Slovenia', he: 'סלובניה', enAliases: ['SVN'], heAliases: [], iso: 'si' },
  { en: 'Spain', he: 'ספרד', enAliases: ['ESP'], heAliases: [], iso: 'es' },
  { en: 'Sweden', he: 'שוודיה', enAliases: ['SWE'], heAliases: [], iso: 'se' },
  { en: 'Switzerland', he: 'שווייץ', enAliases: ['SUI'], heAliases: [], iso: 'ch' },
  { en: 'Türkiye', he: 'טורקיה', enAliases: ['Turkey', 'TUR'], heAliases: [], iso: 'tr' },
  { en: 'Ukraine', he: 'אוקראינה', enAliases: ['UKR'], heAliases: [], iso: 'ua' },
  { en: 'Wales', he: 'וויילס', enAliases: ['WAL'], heAliases: ['ויילס'], iso: 'gb-wls' },
  // ------------------------------------------------------------- CONMEBOL
  { en: 'Argentina', he: 'ארגנטינה', enAliases: ['ARG'], heAliases: [], iso: 'ar' },
  { en: 'Bolivia', he: 'בוליביה', enAliases: ['BOL'], heAliases: [], iso: 'bo' },
  { en: 'Brazil', he: 'ברזיל', enAliases: ['BRA'], heAliases: [], iso: 'br' },
  { en: 'Chile', he: "צ׳ילה", enAliases: ['CHI'], heAliases: ['צילה'], iso: 'cl' },
  { en: 'Colombia', he: 'קולומביה', enAliases: ['COL'], heAliases: [], iso: 'co' },
  { en: 'Ecuador', he: 'אקוודור', enAliases: ['ECU'], heAliases: [], iso: 'ec' },
  { en: 'Paraguay', he: 'פרגוואי', enAliases: ['PAR'], heAliases: [], iso: 'py' },
  { en: 'Peru', he: 'פרו', enAliases: ['PER'], heAliases: [], iso: 'pe' },
  { en: 'Uruguay', he: 'אורוגוואי', enAliases: ['URU'], heAliases: [], iso: 'uy' },
  { en: 'Venezuela', he: 'ונצואלה', enAliases: ['VEN'], heAliases: [], iso: 've' },
  // ------------------------------------------------------------- CONCACAF
  { en: 'United States', he: 'ארצות הברית', enAliases: ['USA', 'USMNT'], heAliases: ['ארה״ב', 'ארהב'], iso: 'us' },
  { en: 'Mexico', he: 'מקסיקו', enAliases: ['MEX'], heAliases: [], iso: 'mx' },
  { en: 'Canada', he: 'קנדה', enAliases: ['CAN'], heAliases: [], iso: 'ca' },
  { en: 'Costa Rica', he: 'קוסטה ריקה', enAliases: ['CRC'], heAliases: [], iso: 'cr' },
  { en: 'Panama', he: 'פנמה', enAliases: ['PAN'], heAliases: [], iso: 'pa' },
  { en: 'Jamaica', he: "ג׳מייקה", enAliases: ['JAM'], heAliases: ['גמייקה'], iso: 'jm' },
  { en: 'Honduras', he: 'הונדורס', enAliases: ['HON'], heAliases: [], iso: 'hn' },
  { en: 'El Salvador', he: 'אל סלבדור', enAliases: ['SLV'], heAliases: [], iso: 'sv' },
  { en: 'Guatemala', he: 'גואטמלה', enAliases: ['GUA'], heAliases: [], iso: 'gt' },
  { en: 'Nicaragua', he: 'ניקרגואה', enAliases: ['NCA'], heAliases: [], iso: 'ni' },
  { en: 'Haiti', he: 'האיטי', enAliases: ['HAI'], heAliases: [], iso: 'ht' },
  { en: 'Cuba', he: 'קובה', enAliases: ['CUB'], heAliases: [], iso: 'cu' },
  { en: 'Trinidad and Tobago', he: 'טרינידד וטובגו', enAliases: ['TRI', 'Trinidad & Tobago'], heAliases: [], iso: 'tt' },
  { en: 'Suriname', he: 'סורינאם', enAliases: ['SUR'], heAliases: [], iso: 'sr' },
  { en: 'Guyana', he: 'גיאנה', enAliases: ['GUY'], heAliases: [], iso: 'gy' },
  { en: 'Curaçao', he: 'קוראסאו', enAliases: ['Curacao', 'CUW'], heAliases: [], iso: 'cw' },
  { en: 'Aruba', he: 'ארובה', enAliases: ['ARU'], heAliases: [], iso: 'aw' },
  { en: 'Bonaire', he: 'בונייר', enAliases: ['BES'], heAliases: [], iso: 'bq' },
  { en: 'Puerto Rico', he: 'פוארטו ריקו', enAliases: ['PUR'], heAliases: [], iso: 'pr' },
  { en: 'Dominican Republic', he: 'הרפובליקה הדומיניקנית', enAliases: ['DOM'], heAliases: [], iso: 'do' },
  { en: 'Martinique', he: 'מרטיניק', enAliases: ['MTQ'], heAliases: [], iso: 'mq' },
  { en: 'Guadeloupe', he: 'גוואדלופ', enAliases: ['GLP'], heAliases: [], iso: 'gp' },
  { en: 'Barbados', he: 'ברבדוס', enAliases: ['BRB'], heAliases: [], iso: 'bb' },
  { en: 'Grenada', he: 'גרנדה', enAliases: ['GRN'], heAliases: [], iso: 'gd' },
  { en: 'Saint Lucia', he: 'סנט לוסיה', enAliases: ['LCA', 'St Lucia'], heAliases: [], iso: 'lc' },
  { en: 'Saint Kitts and Nevis', he: 'סנט קיטס ונוויס', enAliases: ['SKN', 'St Kitts and Nevis'], heAliases: [], iso: 'kn' },
  { en: 'Antigua and Barbuda', he: 'אנטיגואה וברבודה', enAliases: ['ATG', 'Antigua & Barbuda'], heAliases: [], iso: 'ag' },
  { en: 'Dominica', he: 'דומיניקה', enAliases: ['DMA'], heAliases: [], iso: 'dm' },
  { en: 'Bermuda', he: 'ברמודה', enAliases: ['BER'], heAliases: [], iso: 'bm' },
  { en: 'Bahamas', he: 'איי בהאמה', enAliases: ['BAH'], heAliases: ['בהאמה'], iso: 'bs' },
  { en: 'Cayman Islands', he: 'איי קיימן', enAliases: ['CAY'], heAliases: [], iso: 'ky' },
  { en: 'Turks and Caicos Islands', he: 'איי טורקס וקאיקוס', enAliases: ['TCI'], heAliases: [], iso: 'tc' },
  { en: 'Montserrat', he: 'מונטסראט', enAliases: ['MSR'], heAliases: [], iso: 'ms' },
  { en: 'Saint Martin', he: 'סן מרטן', enAliases: ['SMT', 'St Martin'], heAliases: [], iso: 'mf' },
  // ----------------------------------------------------------------- AFC
  { en: 'Japan', he: 'יפן', enAliases: ['JPN'], heAliases: [], iso: 'jp' },
  { en: 'Korea Republic', he: 'דרום קוריאה', enAliases: ['South Korea', 'Korea', 'KOR'], heAliases: [], iso: 'kr' },
  { en: 'Australia', he: 'אוסטרליה', enAliases: ['AUS'], heAliases: [], iso: 'au' },
  { en: 'Saudi Arabia', he: 'ערב הסעודית', enAliases: ['Saudi', 'KSA'], heAliases: ['סעודיה'], iso: 'sa' },
  { en: 'Iran', he: 'איראן', enAliases: ['IRN'], heAliases: [], iso: 'ir' },
  { en: 'Qatar', he: 'קטאר', enAliases: ['QAT'], heAliases: [], iso: 'qa' },
  { en: 'Jordan', he: 'ירדן', enAliases: ['JOR'], heAliases: [], iso: 'jo' },
  { en: 'Uzbekistan', he: 'אוזבקיסטן', enAliases: ['UZB'], heAliases: [], iso: 'uz' },
  // ----------------------------------------------------------------- CAF
  { en: 'Morocco', he: 'מרוקו', enAliases: ['MAR'], heAliases: [], iso: 'ma' },
  { en: 'Algeria', he: "אלג׳יריה", enAliases: ['ALG'], heAliases: ['אלגיריה'], iso: 'dz' },
  { en: 'Tunisia', he: 'תוניסיה', enAliases: ['TUN'], heAliases: [], iso: 'tn' },
  { en: 'Egypt', he: 'מצרים', enAliases: ['EGY'], heAliases: [], iso: 'eg' },
  { en: 'Senegal', he: 'סנגל', enAliases: ['SEN'], heAliases: [], iso: 'sn' },
  { en: 'Nigeria', he: 'ניגריה', enAliases: ['NGA'], heAliases: [], iso: 'ng' },
  { en: 'Ghana', he: 'גאנה', enAliases: ['GHA'], heAliases: [], iso: 'gh' },
  { en: 'Cameroon', he: 'קמרון', enAliases: ['CMR'], heAliases: [], iso: 'cm' },
  { en: 'Ivory Coast', he: 'חוף השנהב', enAliases: ["Côte d'Ivoire", 'Cote dIvoire', 'CIV'], heAliases: [], iso: 'ci' },
  { en: 'South Africa', he: 'דרום אפריקה', enAliases: ['RSA'], heAliases: [], iso: 'za' },
  { en: 'Namibia', he: 'נמיביה', enAliases: ['NAM'], heAliases: [], iso: 'na' },
  { en: 'Congo', he: 'קונגו', enAliases: ['Republic of the Congo', 'Congo Republic', 'CGO'], heAliases: ['רפובליקת קונגו'], iso: 'cg' },
  { en: 'DR Congo', he: 'קונגו הדמוקרטית', enAliases: ['Democratic Republic of the Congo', 'Congo DR', 'COD'], heAliases: [], iso: 'cd' },
  { en: 'Equatorial Guinea', he: 'גינאה המשוונית', enAliases: ['EQG'], heAliases: [], iso: 'gq' },
  { en: 'Sierra Leone', he: 'סיירה לאונה', enAliases: ['SLE'], heAliases: [], iso: 'sl' },
  { en: 'Zimbabwe', he: 'זימבבואה', enAliases: ['ZIM'], heAliases: [], iso: 'zw' },
  { en: 'Mauritania', he: 'מאוריטניה', enAliases: ['MTN'], heAliases: [], iso: 'mr' },
  { en: 'Central African Republic', he: 'הרפובליקה המרכז-אפריקאית', enAliases: ['CAR', 'CTA'], heAliases: [], iso: 'cf' },
  { en: 'Comoros', he: 'קומורו', enAliases: ['COM'], heAliases: [], iso: 'km' },
  { en: 'Uganda', he: 'אוגנדה', enAliases: ['UGA'], heAliases: [], iso: 'ug' },
  { en: 'Libya', he: 'לוב', enAliases: ['LBY'], heAliases: [], iso: 'ly' },
  { en: 'Botswana', he: 'בוטסואנה', enAliases: ['BOT'], heAliases: [], iso: 'bw' },
  { en: 'Tanzania', he: 'טנזניה', enAliases: ['TAN'], heAliases: [], iso: 'tz' },
  { en: 'Guinea-Bissau', he: 'גינאה-ביסאו', enAliases: ['GNB'], heAliases: [], iso: 'gw' },
  { en: 'Niger', he: "ניז׳ר", enAliases: ['NIG'], heAliases: ['ניזר'], iso: 'ne' },
  { en: 'Lesotho', he: 'לסוטו', enAliases: ['LES'], heAliases: [], iso: 'ls' },
  { en: 'Malawi', he: 'מלאווי', enAliases: ['MWI'], heAliases: [], iso: 'mw' },
  { en: 'South Sudan', he: 'דרום סודאן', enAliases: ['SSD'], heAliases: [], iso: 'ss' },
  { en: 'Gambia', he: 'גמביה', enAliases: ['GAM'], heAliases: [], iso: 'gm' },
  { en: 'Somalia', he: 'סומליה', enAliases: ['SOM'], heAliases: [], iso: 'so' },
  { en: 'Togo', he: 'טוגו', enAliases: ['TOG'], heAliases: [], iso: 'tg' },
  { en: 'Burundi', he: 'בורונדי', enAliases: ['BDI'], heAliases: [], iso: 'bi' },
  { en: 'Sudan', he: 'סודאן', enAliases: ['SDN'], heAliases: [], iso: 'sd' },
  { en: 'Ethiopia', he: 'אתיופיה', enAliases: ['ETH'], heAliases: [], iso: 'et' },
  { en: 'Rwanda', he: 'רואנדה', enAliases: ['RWA'], heAliases: [], iso: 'rw' },
  { en: 'Liberia', he: 'ליבריה', enAliases: ['LBR'], heAliases: [], iso: 'lr' },
  { en: 'Madagascar', he: 'מדגסקר', enAliases: ['MAD'], heAliases: [], iso: 'mg' },
  { en: 'Gabon', he: 'גבון', enAliases: ['GAB'], heAliases: [], iso: 'ga' },
  { en: 'Angola', he: 'אנגולה', enAliases: ['ANG'], heAliases: [], iso: 'ao' },
  { en: 'Burkina Faso', he: 'בורקינה פאסו', enAliases: ['BFA'], heAliases: [], iso: 'bf' },
  { en: 'Benin', he: 'בנין', enAliases: ['BEN'], heAliases: [], iso: 'bj' },
  { en: 'Zambia', he: 'זמביה', enAliases: ['ZAM'], heAliases: [], iso: 'zm' },
  { en: 'Mozambique', he: 'מוזמביק', enAliases: ['MOZ'], heAliases: [], iso: 'mz' },
  { en: 'Mali', he: 'מאלי', enAliases: ['MLI'], heAliases: [], iso: 'ml' },
  { en: 'Cape Verde', he: 'כף ורדה', enAliases: ['Cabo Verde', 'CPV'], heAliases: [], iso: 'cv' },
  // ----------------------------------------------------------------- OFC
  { en: 'New Zealand', he: 'ניו זילנד', enAliases: ['NZL'], heAliases: [], iso: 'nz' },
];

/** Flag thumbnail URL for a nation (flagcdn, 80px wide). */
export function flagUrl(iso: string): string {
  return `https://flagcdn.com/w80/${iso}.png`;
}
