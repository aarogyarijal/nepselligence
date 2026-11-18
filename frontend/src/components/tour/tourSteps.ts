/**
 * The guided tour: every step, in order, with its text in English and Nepali.
 *
 * `target` is the value of a `data-tour` attribute on the panel the step lights up.
 * Copy says what a panel is for and what you can do there — the hover tooltips
 * already explain individual numbers.
 */

export type TourLang = 'en' | 'ne'
export type TourPage = 'dashboard' | 'stock'

export interface TourStep {
  id: string
  page: TourPage
  /** data-tour value to light up; null shows the card centred with nothing lit */
  target: string | null
  title: Record<TourLang, string>
  body: Record<TourLang, string>
}

export const LANG_NAMES: Record<TourLang, string> = {
  en: 'English',
  ne: 'नेपाली',
}

const NE_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']
const toNepaliDigits = (n: number) => String(n).replace(/\d/g, d => NE_DIGITS[Number(d)])

export const TOUR_UI: Record<TourLang, {
  button: string
  next: string
  back: string
  close: string
  finish: string
  stepOf: (n: number, total: number) => string
}> = {
  en: {
    button: 'Take the tour',
    next: 'Next',
    back: 'Back',
    close: 'Close',
    finish: 'Finish',
    stepOf: (n, total) => `Step ${n} of ${total}`,
  },
  ne: {
    button: 'भ्रमण गर्नुहोस्',
    next: 'अर्को',
    back: 'पछाडि',
    close: 'बन्द गर्नुहोस्',
    finish: 'सकियो',
    stepOf: (n, total) => `${toNepaliDigits(total)} मध्ये ${toNepaliDigits(n)}`,
  },
}

export const TOUR_STEPS: TourStep[] = [
  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    page: 'dashboard',
    target: null,
    title: {
      en: 'Welcome',
      ne: 'स्वागत छ',
    },
    body: {
      en: 'This short tour shows you what each part of the screen is for. Press Next to move on. You can press Close at any time, and nothing you do here changes anything.',
      ne: 'यो छोटो भ्रमणले स्क्रिनको हरेक भाग केका लागि हो भनेर देखाउँछ। अगाडि बढ्न "अर्को" थिच्नुहोस्। जुनसुकै बेला "बन्द गर्नुहोस्" थिच्न सक्नुहुन्छ, र यहाँ जे थिचे पनि केही बिग्रँदैन।',
    },
  },
  {
    id: 'status',
    page: 'dashboard',
    target: 'status',
    title: {
      en: 'Is the market open?',
      ne: 'बजार खुला छ कि छैन?',
    },
    body: {
      en: 'The green dot means the market is open; grey means it is closed. Beside it are the NEPSE index and the other main indexes, with how much each has moved today.',
      ne: 'हरियो थोप्लो भए बजार खुला छ, खैरो भए बन्द। त्यसको छेउमा NEPSE र अरू मुख्य सूचकहरू छन्, आज कति घटबढ भयो भन्ने सहित।',
    },
  },
  {
    id: 'search',
    page: 'dashboard',
    target: 'search',
    title: {
      en: 'Find a company',
      ne: 'कम्पनी खोज्नुहोस्',
    },
    body: {
      en: 'Type the first letters of a company name or its symbol here. A list appears below; click the one you want to open its page.',
      ne: 'यहाँ कम्पनीको नाम वा सिम्बोलका सुरुका अक्षर टाइप गर्नुहोस्। तल सूची आउँछ; चाहेको कम्पनीमा थिचेपछि त्यसको पाना खुल्छ।',
    },
  },
  {
    id: 'admin-actions',
    page: 'dashboard',
    target: 'admin-actions',
    title: {
      en: 'You can ignore these',
      ne: 'यी बटन छोडे हुन्छ',
    },
    body: {
      en: 'These buttons are for maintenance. The dashboard fetches new prices by itself, so you never need to press them.',
      ne: 'यी बटन मर्मतसम्भारका लागि हुन्। ड्यासबोर्डले नयाँ मूल्य आफैँ ल्याउँछ, त्यसैले यी थिच्नु पर्दैन।',
    },
  },
  {
    id: 'range',
    page: 'dashboard',
    target: 'range',
    title: {
      en: 'Choose the time period',
      ne: 'समय अवधि छान्नुहोस्',
    },
    body: {
      en: 'These buttons set how far back the whole page looks: today, the last trading day, five days, a month, up to a year. Everything below changes to match.',
      ne: 'यी बटनले पूरै पानाले कति पछाडिसम्म हेर्ने भनेर तय गर्छन्: आज, अघिल्लो कारोबार दिन, पाँच दिन, एक महिना, एक वर्षसम्म। तलका सबै कुरा त्यहीअनुसार फेरिन्छन्।',
    },
  },
  {
    id: 'index-chart',
    page: 'dashboard',
    target: 'index-chart',
    title: {
      en: 'The NEPSE index',
      ne: 'NEPSE सूचक',
    },
    body: {
      en: 'This line shows how the whole market has moved over the period you chose. Move the pointer along the line to see the value at any moment.',
      ne: 'तपाईंले छानेको अवधिमा पूरै बजार कसरी चल्यो भनेर यो रेखाले देखाउँछ। रेखामाथि माउस लैजाँदा त्यस बेलाको अङ्क देखिन्छ।',
    },
  },
  {
    id: 'sectors',
    page: 'dashboard',
    target: 'sectors',
    title: {
      en: 'Sectors',
      ne: 'क्षेत्रहरू',
    },
    body: {
      en: 'Each row is one sector, such as banks, hydropower or insurance. Green sectors have risen and red ones have fallen, so you can see where the market is strong.',
      ne: 'हरेक लहर एउटा क्षेत्र हो, जस्तै बैंक, जलविद्युत्, बीमा। हरियो क्षेत्र बढेको हो, रातो घटेको; यसबाट बजार कता बलियो छ भन्ने थाहा हुन्छ।',
    },
  },
  {
    id: 'movers',
    page: 'dashboard',
    target: 'movers',
    title: {
      en: 'Biggest rises and falls',
      ne: 'सबैभन्दा बढेका र घटेका',
    },
    body: {
      en: 'On the left are the shares that rose the most; on the right, the ones that fell the most. Click any name to see more about that company.',
      ne: 'देब्रेतिर सबैभन्दा बढेका सेयर छन्, दाहिनेतिर सबैभन्दा घटेका। कुनै नाममा थिच्दा त्यो कम्पनीबारे थप जानकारी खुल्छ।',
    },
  },
  {
    id: 'turnover',
    page: 'dashboard',
    target: 'turnover',
    title: {
      en: 'Where the money went',
      ne: 'पैसा कता गयो',
    },
    body: {
      en: 'These are the shares with the highest turnover, meaning the most rupees traded. They are the ones most people are buying and selling right now.',
      ne: 'यी सबैभन्दा बढी turnover भएका, अर्थात् सबैभन्दा धेरै रुपैयाँको कारोबार भएका सेयर हुन्। अहिले धेरैजसो मानिसले यिनै किनबेच गरिरहेका छन्।',
    },
  },
  {
    id: 'breadth',
    page: 'dashboard',
    target: 'breadth',
    title: {
      en: 'How many went up or down',
      ne: 'कति बढे, कति घटे',
    },
    body: {
      en: 'This counts how many companies rose, fell or stayed the same. If the index is up but most companies are down, only a few big ones are lifting it.',
      ne: 'कति कम्पनी बढे, कति घटे र कति स्थिर रहे भनेर यहाँ गनिएको छ। सूचक बढेको तर धेरै कम्पनी घटेका छन् भने केही ठूला कम्पनीले मात्र बजार तानेका हुन्।',
    },
  },
  {
    id: 'trade-activity',
    page: 'dashboard',
    target: 'trade-activity',
    title: {
      en: "Today's trading",
      ne: 'आजको कारोबार',
    },
    body: {
      en: "A summary of today's trades: how many there were, and which shares saw unusually large deals.",
      ne: 'आजको कारोबारको सार: जम्मा कति कारोबार भयो, र कुन सेयरमा असामान्य ठूला कारोबार भए।',
    },
  },
  {
    id: 'ai-insights',
    page: 'dashboard',
    target: 'ai-insights',
    title: {
      en: 'What the AI makes of it',
      ne: 'AI ले के भन्छ',
    },
    body: {
      en: "The AI reads the day's numbers and writes a short summary in plain words. Treat it as a second opinion to think about, not as advice to buy or sell.",
      ne: 'AI ले दिनभरिका अङ्क हेरेर सरल भाषामा छोटो सार लेख्छ। यसलाई सोच्नका लागि दोस्रो राय ठान्नुहोस्, किन्ने वा बेच्ने सल्लाह होइन।',
    },
  },
  {
    id: 'news',
    page: 'dashboard',
    target: 'news',
    title: {
      en: 'News',
      ne: 'समाचार',
    },
    body: {
      en: 'The latest market news from Nepali sources. Click a headline to read the full story; it opens in a new tab, so this page stays where it is.',
      ne: 'नेपाली स्रोतहरूबाट आएका बजारका ताजा समाचार। शीर्षकमा थिच्दा पूरा समाचार नयाँ ट्याबमा खुल्छ, यो पाना जस्ताको तस्तै रहन्छ।',
    },
  },

  // ── Stock page ───────────────────────────────────────────────────────────
  {
    id: 'stock-header',
    page: 'stock',
    target: 'stock-header',
    title: {
      en: "One company's page",
      ne: 'एउटा कम्पनीको पाना',
    },
    body: {
      en: 'The tour has opened one share as an example. Every company has a page like this. At the top are its latest price, how much it changed today, and where that price sits between its lowest and highest of the past year.',
      ne: 'उदाहरणका लागि भ्रमणले एउटा सेयर खोलेको छ। हरेक कम्पनीको यस्तै पाना हुन्छ। माथि पछिल्लो मूल्य, आज कति घटबढ भयो, र त्यो मूल्य गत एक वर्षको न्यूनतम र अधिकतमको बीचमा कहाँ छ भन्ने देखिन्छ।',
    },
  },
  {
    id: 'stock-chart',
    page: 'stock',
    target: 'stock-chart',
    title: {
      en: 'Price chart',
      ne: 'मूल्यको चार्ट',
    },
    body: {
      en: "This shows how the share's price has moved. The buttons above the chart switch between a day, a month and a year.",
      ne: 'सेयरको मूल्य कसरी चल्यो भनेर यसले देखाउँछ। चार्टमाथिका बटनले एक दिन, एक महिना वा एक वर्ष छान्न मिल्छ।',
    },
  },
  {
    id: 'stock-news',
    page: 'stock',
    target: 'stock-news',
    title: {
      en: 'News about this company',
      ne: 'यस कम्पनीका समाचार',
    },
    body: {
      en: 'Recent news that mentions this company. It is worth a look before you decide anything.',
      ne: 'यस कम्पनीको नाम आएका पछिल्ला समाचार। कुनै निर्णय गर्नुअघि एकपटक हेर्नु राम्रो हुन्छ।',
    },
  },
  {
    id: 'stock-technicals',
    page: 'stock',
    target: 'stock-technicals',
    title: {
      en: 'Indicators and signals',
      ne: 'सूचक र संकेत',
    },
    body: {
      en: 'These cards sum up what the price has been doing: whether it is trending up or down, and how it did over the past weeks and months. Rest the pointer on any underlined word for a plain explanation.',
      ne: 'मूल्यले के गरिरहेको छ भनेर यी कार्डले सार दिन्छन्: बढ्दो छ कि घट्दो, र पछिल्ला हप्ता र महिनामा कस्तो रह्यो। तल रेखा कोरिएको कुनै शब्दमा माउस राख्दा सरल व्याख्या आउँछ।',
    },
  },
  {
    id: 'stock-stats',
    page: 'stock',
    target: 'stock-stats',
    title: {
      en: 'Volume, swings and comparison',
      ne: 'कारोबार, उतारचढाव र तुलना',
    },
    body: {
      en: 'How heavily the share is being traded, how sharply its price swings, and whether it is doing better or worse than the market and its own sector.',
      ne: 'यो सेयर कति धेरै कारोबार भइरहेको छ, यसको मूल्य कति उतारचढाव हुन्छ, र यो बजार तथा आफ्नै क्षेत्रभन्दा राम्रो छ कि कमजोर।',
    },
  },
  {
    id: 'stock-ai',
    page: 'stock',
    target: 'stock-ai',
    title: {
      en: 'Ask the AI about this share',
      ne: 'यस सेयरबारे AI लाई सोध्नुहोस्',
    },
    body: {
      en: 'The AI writes its reading of this company here. You can also type a question in your own words, in English or Nepali, and it will answer.',
      ne: 'AI ले यस कम्पनीबारे आफ्नो विश्लेषण यहाँ लेख्छ। आफ्नै शब्दमा, नेपाली वा अङ्ग्रेजीमा, प्रश्न टाइप गरेर सोध्न पनि सक्नुहुन्छ।',
    },
  },
  {
    id: 'stock-floorsheet',
    page: 'stock',
    target: 'stock-floorsheet',
    title: {
      en: 'Every trade, one by one',
      ne: 'हरेक कारोबार, एक-एक गरी',
    },
    body: {
      en: "This is the floorsheet: every single trade in this share today, grouped by time, with which broker bought and which sold. It is the most detailed part of the page, and it is fine to skip it.",
      ne: 'यो floorsheet हो: आज यस सेयरमा भएका हरेक कारोबार, समयअनुसार समूहमा, कुन ब्रोकरले किन्यो र कुनले बेच्यो भन्ने सहित। यो पानाको सबैभन्दा विस्तृत भाग हो; नहेरे पनि हुन्छ।',
    },
  },
  {
    id: 'stock-back',
    page: 'stock',
    target: 'stock-back',
    title: {
      en: 'Going back',
      ne: 'फर्कने तरिका',
    },
    body: {
      en: 'Click "Dashboard" here to return to the main page. That is the whole tour. To see it again, press "Take the tour" at the top of the page whenever you like.',
      ne: 'मुख्य पानामा फर्कन यहाँ "Dashboard" थिच्नुहोस्। भ्रमण यति नै हो। फेरि हेर्न मन लागे जुनसुकै बेला पानाको माथि रहेको "भ्रमण गर्नुहोस्" थिच्नुहोस्।',
    },
  },
]

/** From the dashboard the tour covers both pages; from a stock page, only that page. */
export function stepsFor(start: TourPage): TourStep[] {
  return start === 'dashboard' ? TOUR_STEPS : TOUR_STEPS.filter(s => s.page === 'stock')
}
