// All visitor-facing text lives here so it can be edited without touching the 3D code.
// tag / tagEn : short floating label     title / sub : card heading (JP / EN)
// body / en   : card text (JP / EN)      note        : small footnote
// "\n" in body becomes a line break.

export interface CardInfo {
  tag: string; tagEn?: string; kicker?: string;
  title?: string; sub?: string;
  body?: string; en?: string; note?: string;
}
export interface EraInfo { year: string; name: string; en: string }
export interface GateInfo { label: string[]; tag: string; tagEn: string; warp: string }

export const ERAS: Record<string, EraInfo> = {
  launch: { year: '2126', name: '地球', en: 'Earth · Launch site' },
  space:  { year: '2126', name: '宇宙', en: 'Outer Space' },
  moon:   { year: '2126', name: '月',   en: 'The Moon' },
  mars:   { year: '2126', name: '火星', en: 'Mars' },
};

const SCALE_NOTE = '※大きさ・距離は縮尺どおりではありません / Not to scale';
const FUTURE_NOTE = '※これは想像の未来です / A speculative future';
const MOON_KICKER = '2126 · 月 MOON';
const MARS_KICKER = '2126 · 火星 MARS';

export const SPACE: Record<string, CardInfo> = {
  earth: {
    tag: '地球', tagEn: 'Earth', kicker: '2126 · EARTH',
    title: '地球 — わたしたちのふるさと', sub: 'Earth, our home',
    body: '月にも火星にも基地ができた2126年。それでも、わたしたちのふるさとは、この青い星です。\nゲートを選んで、旅に出よう。帰ってくる場所は、いつもここです。',
    en: 'In 2126 there are bases on the Moon and Mars, but our home is still this blue planet. Pick a gate and set off. This is where you will always come back to.',
  },
  moon: {
    tag: '月', tagEn: 'Moon', kicker: 'MOON',
    title: '月', sub: 'The Moon',
    body: '地球から約38万km。月の光は約1.3秒で地球に届きます。\n1969年、アポロ11号で人類が初めて月に降り立ちました。いまでは月に基地があり、ゲートから行けます。',
    en: 'About 384,000 km away; its light reaches us in 1.3 seconds. Humans first walked on it in 1969 (Apollo 11). Today there is a base there, and a gate will take you.',
    note: SCALE_NOTE,
  },
  mars: {
    tag: '火星', tagEn: 'Mars', kicker: 'MARS',
    title: '火星', sub: 'Mars',
    body: '地球のすぐ外側をまわる赤い惑星。1日は約24時間40分、重力は地球の約38%。\nいまでは人が暮らす基地があり、ゲートから行けます。',
    en: 'The red planet next door. A day lasts about 24 h 40 min and gravity is 38% of Earth\'s. Today people live in a base there, and a gate will take you.',
    note: SCALE_NOTE,
  },
  saturn: {
    tag: '土星', tagEn: 'Saturn', kicker: 'SATURN',
    title: '土星', sub: 'Saturn',
    body: '美しい環は、無数の氷や岩のかけらでできています。\n土星はとても軽く、平均密度は水よりも小さいのです。',
    en: 'Its rings are countless pieces of ice and rock. Saturn is so light that its average density is lower than water\'s.',
    note: SCALE_NOTE,
  },
  sun: {
    tag: '太陽', tagEn: 'Sun', kicker: 'SUN',
    title: '太陽', sub: 'The Sun',
    body: '太陽の光が地球に届くまで約8分20秒。\nいま見ている太陽は、約8分前の姿なのです。',
    en: 'Sunlight takes about 8 min 20 s to reach Earth, so we always see the Sun as it was 8 minutes ago.',
    note: SCALE_NOTE,
  },
};

export const MOON: Record<string, CardInfo> = {
  data: {
    tag: '2126年の月', tagEn: 'Moon facts', kicker: MOON_KICKER,
    title: '2126年の月', sub: 'The Moon in 2126',
    body: '地球から約38万km。重力は地球の約6分の1で、地球で30kgの荷物も5kgくらいの重さに感じます。\n昼と夜はそれぞれ約2週間つづき、昼は100℃以上、夜は−170℃近くまで下がります。',
    en: 'About 384,000 km from Earth, with one-sixth of Earth\'s gravity: a 30 kg bag feels like 5 kg. Day and night each last about two weeks, with over 100 °C by day and close to −170 °C at night.',
  },
  base: {
    tag: '月面基地', tagEn: 'Lunar base', kicker: MOON_KICKER,
    title: '月面基地', sub: 'A home on the Moon',
    body: '月には空気がなく、宇宙からの放射線や小さな隕石がふりそそぎます。\nそこでドームを月の砂(レゴリス)でおおって身を守ります。ガラスの温室では野菜を育てています。',
    en: 'The Moon has no air, so radiation and tiny meteorites rain down. The domes are covered with lunar soil (regolith) for protection, and vegetables grow in the glass greenhouse.',
    note: FUTURE_NOTE,
  },
  ice: {
    tag: '氷のクレーター', tagEn: 'Ice crater', kicker: MOON_KICKER,
    title: '氷のクレーター', sub: 'Water ice in eternal shadow',
    body: '月の南極には、太陽の光が一度も当たらない「永久影」のクレーターがあり、水の氷が見つかっています。\nここでは氷をほり出して、飲み水や呼吸する酸素、ロケットの燃料をつくっています。',
    en: 'Near the Moon\'s south pole, some craters never see sunlight, and water ice has been found inside them. Here the ice is mined and turned into drinking water, oxygen to breathe and rocket fuel.',
    note: '※氷は本当に見つかっています。採掘は想像です / The ice is real; the mining is imagined',
  },
  rover: {
    tag: '月面車', tagEn: 'Pressurized rover', kicker: MOON_KICKER,
    title: '月面を走るクルマ', sub: 'Pressurized rover',
    body: '約100年前、トヨタとJAXAは、宇宙服をぬいで中で過ごせる月面車「ルナクルーザー」の開発を始めました。\nいまでは、その子孫が月の上を自由に走っています。',
    en: 'About 100 years ago, Toyota and JAXA began developing the Lunar Cruiser, a rover where astronauts could take off their spacesuits inside. Today its descendants drive freely across the Moon.',
    note: FUTURE_NOTE,
  },
  port: {
    tag: '月の宇宙港', tagEn: 'Spaceport', kicker: MOON_KICKER,
    title: '月の宇宙港', sub: 'Gateway to Mars and beyond',
    body: '月は重力が小さく空気もないので、地球よりずっと少ない燃料でロケットを打ち上げられます。\nいまでは月が、火星やもっと遠くへ向かう船の中継地になっています。',
    en: 'With low gravity and no air, rockets can launch from the Moon with far less fuel than from Earth. Today the Moon is the stopover for ships heading to Mars and beyond.',
    note: FUTURE_NOTE,
  },
  apollo: {
    tag: 'アポロ11号', tagEn: 'Apollo 11 site', kicker: MOON_KICKER,
    title: 'アポロ11号の着陸地', sub: 'Where people first walked on the Moon',
    body: '1969年、アポロ11号のアームストロング船長とオルドリン飛行士が、人類で初めて月面を歩きました。\n風も雨もない月では、足あとがほとんど消えずに残ります。いまでは着陸地点が博物館として守られています。',
    en: 'In 1969, Neil Armstrong and Buzz Aldrin of Apollo 11 became the first people to walk on the Moon. With no wind or rain, their footprints barely fade. Today the landing site is kept as a museum.',
    note: '※場所と大きさは実際とちがいます。博物館は想像です / Location and size not real; the museum is imagined',
  },
  earth: {
    tag: '月から見た地球', tagEn: 'Earth from the Moon', kicker: MOON_KICKER,
    title: '月から見た地球', sub: 'Earth in the lunar sky',
    body: '月の表側から見ると、地球は空のほぼ同じ場所に浮かんだまま、のぼることも沈むこともありません。\n地球から見る月の約4倍の大きさで、月と同じように満ち欠けします。',
    en: 'From the Moon\'s near side, Earth hangs in almost the same spot in the sky and never rises or sets. It looks about four times wider than the Moon does from Earth, and it has phases too.',
    note: SCALE_NOTE,
  },
  you: {
    tag: 'ふりかえると', tagEn: 'Look back', kicker: MOON_KICKER,
    title: 'ふりかえると、地球', sub: 'Look back at Earth',
    body: '月には、空気も、流れる水も、緑もありません。基地の中でしか生きられません。\n空に浮かぶあの青い星だけが、わたしたちがそのまま生きられる場所です。',
    en: 'The Moon has no air, no flowing water and nothing green; people can only live inside the base. That blue planet in the sky is the only place where we can simply live.',
  },
};

export const MARS: Record<string, CardInfo> = {
  data: {
    tag: '2126年の火星', tagEn: 'Mars facts', kicker: MARS_KICKER,
    title: '2126年の火星', sub: 'Mars in 2126',
    body: '地球からの距離は、近いときで約5,600万km、遠いときは約4億km。重力は地球の約38%です。\n空気はとてもうすく(地球の1%以下)、ほとんどが二酸化炭素。平均気温は約−60℃です。',
    en: 'Between about 56 million and 400 million km from Earth, with 38% of Earth\'s gravity. The air is less than 1% as thick as Earth\'s and mostly carbon dioxide, and the average temperature is about −60 °C.',
  },
  base: {
    tag: '火星の家', tagEn: 'Printed homes', kicker: MARS_KICKER,
    title: '火星の土でつくる家', sub: '3D-printed homes',
    body: '火星の土を3Dプリンターで固めて、家をつくります。厚いかべが、寒さと宇宙からの放射線から守ってくれます。\n約100年前、NASAはこうした家のアイデアを競うコンテストを開いていました。',
    en: 'Homes are printed from Martian soil by giant 3D printers, and their thick walls keep out the cold and radiation. About 100 years ago, NASA ran design contests for habitats like these.',
    note: FUTURE_NOTE,
  },
  oxygen: {
    tag: '酸素をつくる', tagEn: 'Making oxygen', kicker: MARS_KICKER,
    title: '空気から酸素をつくる', sub: 'Oxygen from thin air',
    body: '2021年、探査車パーサヴィアランスに積まれた装置「MOXIE」が、火星の空気(二酸化炭素)から酸素をつくることに成功しました。\nいまでは大きな工場が、人が吸う酸素をつくっています。',
    en: 'In 2021, MOXIE, an instrument on NASA\'s Perseverance rover, made oxygen from the carbon dioxide in Mars\'s air. Today big plants make the oxygen people breathe.',
    note: '※MOXIEは本当、工場は想像です / MOXIE is real; the plant is imagined',
  },
  drone: {
    tag: '火星のヘリコプター', tagEn: 'Mars helicopter', kicker: MARS_KICKER,
    title: '火星の空を飛ぶ', sub: 'Flying on Mars',
    body: '2021年、小さなヘリコプター「インジェニュイティ」が、地球以外の星で初めて空を飛びました。\nいまでは、その子孫のドローンが基地の上を飛んでいます。空気がうすいので、羽根をとても速く回して飛びます。',
    en: 'In 2021 the small helicopter Ingenuity made the first powered flight on another planet. Today its descendants fly over the base; the air is so thin that their blades have to spin very fast.',
    note: '※インジェニュイティは本当、この先の未来は想像です / Ingenuity is real; the rest is imagined',
  },
  olympus: {
    tag: 'オリンポス山', tagEn: 'Olympus Mons', kicker: MARS_KICKER,
    title: 'オリンポス山', sub: 'The tallest volcano in the solar system',
    body: '太陽系でいちばん高い火山。高さは約22kmで、エベレストの約2.5倍です。\nすそ野の直径は約600kmもあります。',
    en: 'The tallest volcano in the solar system: about 22 km high, roughly two and a half times Mount Everest, and about 600 km across.',
    note: SCALE_NOTE,
  },
  dust: {
    tag: '砂あらし', tagEn: 'Dust storms', kicker: MARS_KICKER,
    title: '砂あらしと青い夕焼け', sub: 'Dust devils and blue sunsets',
    body: '火星では、ちりを巻き上げるつむじ風「ダストデビル」や、星全体をおおう砂あらしが起こります。\n細かいちりのせいで空は赤っぽく、夕焼けはなんと青く見えます。',
    en: 'Mars has dust devils, and dust storms that can cover the whole planet. The fine dust makes the sky reddish, and sunsets look blue.',
  },
  earth: {
    tag: '火星から見た地球', tagEn: 'Earth from Mars', kicker: MARS_KICKER,
    title: 'ふりかえると、小さな地球', sub: 'Earth from Mars',
    body: '火星の夕空では、地球は明るい星のひとつにしか見えません。電波でも片道3分から22分かかります。\nここでは空気も水も食べ物も、機械でつくり出さなければなりません。あの小さな点が、わたしたちがそのまま生きられる、ただひとつの場所です。',
    en: 'In the Martian evening sky, Earth is just one bright star; even radio takes 3 to 22 minutes to get there. Here, air, water and food all have to be made by machines. That small dot is the only place where we can simply live.',
  },
};

// ---------- the booth flow: launch → space → destination → home ----------
// one entry per destination (see js/destinations.ts)
export const GATES: Record<string, GateInfo> = {
  moon: {
    label: ['月', 'THE MOON'],
    tag: '月へ', tagEn: 'To the Moon',
    warp: '月へ · TO THE MOON',
  },
  mars: {
    label: ['火星', 'MARS'],
    tag: '火星へ', tagEn: 'To Mars',
    warp: '火星へ · TO MARS',
  },
};

export const FLOW = {
  welcome: (name: string) => `ようこそ、${name}さん! / Welcome, ${name}!`,
  launchHint: '手を下から上へ、大きく動かして発射! / Move your hand from low to high to launch',
  liftoff: '発射! LIFTOFF',
  toSpace: '宇宙へ · INTO SPACE',
  chooseHint: 'ゲートを選んで、行き先を決めよう / Choose a gate to pick your destination',
  homeWarp: '地球へ帰還 · RETURNING TO EARTH',
  homeCaption: 'ただいま、地球。 / Hello again, Earth.',
  landing: '着陸 · LANDING',
  backHome: ['地球へ帰る', 'Fly home'] as [string, string],
  backEarthView: ['地球を見る', 'Look at Earth'] as [string, string],
  finish: ['おわる', 'Finish'] as [string, string],
  finale: {
    title: 'おかえりなさい', titleNamed: (name: string) => `おかえりなさい、${name}さん`, sub: 'Welcome home',
    body: 'いま知られているなかで、生命がいる星は地球だけです。\n空気も、水も、ちょうどいい温度も、ここにはすべてそろっています。\nこの星を、大切に。',
    en: 'Of all the worlds we know, Earth is the only one known to have life. Air, water and just the right warmth are all here. Please take good care of it.',
    end: '✊ グーでおわる / Make a fist to finish',
  },
  nextUp: (n: number, name: string) => `次は #${n} ${name}さん / Next: #${n} ${name}`,
  tapTag: 'NFCタグにタッチしてチェックイン / Tap the NFC tag to check in',
  needCheckin: (n: number, name: string) => `#${n} ${name}さん、NFCタグにスマホをタッチしてチェックインしてね / #${n} ${name}, please check in on the NFC tag`,
  registerHint: 'スマホで読みとって順番を予約 / Scan to join the queue',
};
