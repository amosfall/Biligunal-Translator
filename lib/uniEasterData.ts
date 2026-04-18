/**
 * 高校 AKI 彩蛋数据：每条 match 对应多条 { zh, en }，展示时随机取一条。
 */

import { mergeUniversityNicknameSupplement } from "./mergeUniNicknameSupplement";

export type UniVariation = { zh: string; en: string };

export type UniRow = { match: string; variations: UniVariation[] };

const UNIVERSITY_ROWS_BASE: UniRow[] = [
  // —— 中国（联合校名在前）——
  {
    match: "华中师范大学 + 武汉理工大学",
    variations: [
      {
        zh: "华师缺男，理工缺女，中间隔一堵墙，墙上有个洞",
        en: "CCNU lacks guys, WHUT lacks girls—a wall in between, and campus lore says there's a hole in it.",
      },
    ],
  },
  {
    match: "天津大学 + 南开大学",
    variations: [
      {
        zh: "天大是六里台工头，南开是七里台文员，两校共用一个天桥，谁也不服谁",
        en: "Tianjin is the Liulitai foreman, Nankai the Qilitai clerk—one footbridge, two egos, eternal rivalry.",
      },
    ],
  },
  {
    match: "清华大学",
    variations: [
      {
        zh: "体校，3000米跑不合格不能毕业",
        en: "Satire paints it as a sports school: fail the 3,000-meter run and you don't graduate.",
      },
      {
        zh: "男生不会谈恋爱，只会刷题和搞基",
        en: "The roast: guys only grind problem sets—or each other—not romance.",
      },
    ],
  },
  {
    match: "北京大学",
    variations: [
      {
        zh: "文科生看不起所有人，理科生看不起文科生",
        en: "Arts students look down on everyone; STEM students look down on arts.",
      },
      {
        zh: "学生会搞事第一名，学术第二",
        en: "Student politics first, scholarship second—so the joke goes.",
      },
    ],
  },
  {
    match: "上海交通大学",
    variations: [
      {
        zh: "闵行大农村，进城要坐一小时地铁",
        en: "Minhang feels like the countryside—an hour on the subway to downtown.",
      },
      {
        zh: "全体学生都在思考如何转码",
        en: "Everyone's secretly plotting how to pivot into coding.",
      },
    ],
  },
  {
    match: "浙江大学",
    variations: [
      {
        zh: "校区太多，谈个恋爱像异地恋",
        en: "So many campuses that dating feels long-distance.",
      },
      {
        zh: "自称全国第三，但另外两个是谁不敢说",
        en: "They joke they're 'third in China' but never name who one and two are.",
      },
    ],
  },
  {
    match: "华中科技大学",
    variations: [
      {
        zh: "森林覆盖率比绿化还高，校园里有野猪出没",
        en: "Forest cover beats the 'greening' stats—wild boars included.",
      },
      {
        zh: "学在华科，玩在武大，死在汉口",
        en: "Learn at HUST, party at Wuhan U, 'die' in Hankou nightlife.",
      },
    ],
  },
  {
    match: "南京大学",
    variations: [
      {
        zh: "存在感忽高忽低，江苏人觉得它是省内第一，外地人问“南大是南开还是南昌”",
        en: "Jiangsu locals crown it #1; outsiders ask if 'Nanda' is Nankai or Nanchang.",
      },
      {
        zh: "宿舍条件让人怀疑是不是民国建筑保留至今",
        en: "Dorms look preserved from the Republic era.",
      },
    ],
  },
  {
    match: "武汉大学",
    variations: [
      {
        zh: "樱花开了＝全武汉的人都来了，本校学生进不去",
        en: "Cherry blossom season means all of Wuhan visits—students can't get in.",
      },
      {
        zh: "风景好到让人忘记学习，挂科率高到让人想起学习",
        en: "Views distract you; failing grades snap you back to reality.",
      },
    ],
  },
  {
    match: "厦门大学",
    variations: [
      {
        zh: "面朝大海，空调暴晒，游客比学生多",
        en: "Sea view but AC and sun roast you—tourists outnumber students.",
      },
      {
        zh: "食堂好吃到大学四年胖三十斤",
        en: "Canteen so good you gain thirty jin in four years.",
      },
    ],
  },
  {
    match: "中国海洋大学",
    variations: [
      {
        zh: "全校都在学水产，毕业了真的去养鱼",
        en: "Everyone studies fisheries—and yes, grads actually go raise fish.",
      },
    ],
  },
  {
    match: "电子科技大学",
    variations: [
      {
        zh: "男女比例七比一，一对情侣三对基",
        en: "Seven guys per girl—one couple, three pairs of 'bros.'",
      },
      {
        zh: "郫县男孩，毕业即秃头",
        en: "Pixian boys graduate straight into receding hairlines.",
      },
    ],
  },
  {
    match: "华中农业大学",
    variations: [{ zh: "种地的，但种得很有科学", en: "They farm—but with peer-reviewed precision." }],
  },
  {
    match: "中南民族大学",
    variations: [
      {
        zh: "南湖三兄弟之一，主业是陪跑",
        en: "One of Nanhu's three brothers—main job is cheering from the sidelines.",
      },
    ],
  },
  {
    match: "湖北工业大学",
    variations: [
      {
        zh: "南湖三兄弟之一，主打一个来都来了",
        en: "Another Nanhu brother school—'we're already here, might as well' energy.",
      },
    ],
  },
  {
    match: "中国农业大学",
    variations: [
      {
        zh: "种猪选育，听起来像玩笑，其实是真王牌专业",
        en: "Breeding stud pigs sounds like a punchline—it's actually a flagship program.",
      },
    ],
  },
  {
    match: "上海海事大学",
    variations: [
      {
        zh: "毕业去开船，女生去当海嫂",
        en: "Guys graduate to sail; women become 'captain's wives' at sea—old maritime joke.",
      },
    ],
  },
  {
    match: "北京师范大学",
    variations: [
      {
        zh: "积水潭师专，毕业生只会说“这个不对，我查一下教材”",
        en: "Jishuitan 'normal college'—alumni only say 'that's wrong, let me check the textbook.'",
      },
    ],
  },
  {
    match: "中山大学",
    variations: [
      {
        zh: "双鸭山大学，广东人的北大，北方人以为是黑龙江的学校",
        en: '"Double Duck Mountain U"—Guangdong\'s Peking U; northerners think you mean Heilongjiang.',
      },
    ],
  },
  {
    match: "复旦大学",
    variations: [
      {
        zh: "五角场文秘职业技术学院，自称自由而无用，实际卷得要死",
        en: "Wujiaochang secretarial college—claims 'free and useless,' actually brutally competitive.",
      },
    ],
  },
  {
    match: "同济大学",
    variations: [
      {
        zh: "上海市第一建筑施工队，学生实习就是在工地",
        en: "Shanghai's top construction crew—internship is literally the job site.",
      },
    ],
  },
  {
    match: "兰州大学",
    variations: [
      {
        zh: "榆中大学，荒漠求生体验营，风沙大到手机进灰",
        en: "Yuzhong survival camp—sandstorms shove grit into your phone.",
      },
    ],
  },
  {
    match: "西北农林科技大学",
    variations: [
      {
        zh: "秦岭农民培训基地，实习是去种树和给牛接生",
        en: "Qinling farmer boot camp—internships: plant trees, deliver calves.",
      },
    ],
  },
  {
    match: "河海大学",
    variations: [
      {
        zh: "水利专业全国第一，但全校都在解释“我们不是大专”",
        en: "Top hydraulics in China—yet everyone explains 'we're not a vocational college.'",
      },
    ],
  },
  {
    match: "江南大学",
    variations: [
      {
        zh: "太湖食品工业学院，酿酒专业比学校有名",
        en: "Taihu food-tech institute—the brewing program is more famous than the school name.",
      },
    ],
  },
  {
    match: "北京体育大学",
    variations: [
      {
        zh: "全校都是体育生，但体测挂科的人比清华还多",
        en: "All sports majors—yet more people fail PE tests than at Tsinghua, says the joke.",
      },
    ],
  },
  {
    match: "中央民族大学",
    variations: [
      {
        zh: "魏公村清真餐饮培训基地，食堂是全北京高校的朝圣地",
        en: "Weigongcun halal catering school—cafeteria is a pilgrimage for all Beijing campuses.",
      },
    ],
  },
  {
    match: "中央戏剧学院",
    variations: [
      {
        zh: "Aki的本科学校，真是怀念呀！",
        en: "The Central Academy of Drama—AKI's undergrad days, good old nostalgia.",
      },
    ],
  },
  {
    match: "北京外国语大学",
    variations: [
      {
        zh: "抗日军政大学俄文大队，女生多到男生走路都得排队",
        en: "Russian brigade of the old resistance academy—so many women that guys queue just to walk.",
      },
    ],
  },
  {
    match: "中国传媒大学",
    variations: [
      {
        zh: "定福庄二小附属大学，学生忙着当网红，老师忙着拉片子",
        en: "Dingfuzhuang elementary annex—students chase influencer fame, faculty chase rough cuts.",
      },
    ],
  },
  {
    match: "四川大学",
    variations: [
      {
        zh: "成都七中附属大学，四川人不爱出川，全在川大卷",
        en: "Chengdu No.7 High annex—Sichuan people won't leave the province; they grind inside SCU.",
      },
    ],
  },
  {
    match: "重庆大学",
    variations: [
      {
        zh: "沙坪坝男子职业技术学校，爬坡上坎，腿力惊人",
        en: "Shapingba men's vocational school—hills and stairs, legendary calves.",
      },
    ],
  },
  {
    match: "东北大学",
    variations: [
      {
        zh: "南湖职业技术学校，冬天上课等于极限挑战",
        en: "South Lake vocational school—winter class is an Extreme Challenge episode.",
      },
    ],
  },
  {
    match: "吉林大学",
    variations: [
      {
        zh: "长春市坐地户，长春在吉大里面，吉大不在长春里面",
        en: "Changchun locals—the city lives inside JLU, not the other way around.",
      },
    ],
  },
  {
    match: "山东大学",
    variations: [
      {
        zh: "兴隆山男子技校，省内人觉得是神，省外人问“这是211吗”",
        en: "Xinglongshan men's tech—godlike inside Shandong; outsiders ask if it's even 211.",
      },
    ],
  },
  {
    match: "湖南大学",
    variations: [
      {
        zh: "岳麓山风景区管理处，没有校门，游客以为它是公园",
        en: "Yuelu Mountain scenic HQ—no real gate; tourists think it's a park.",
      },
    ],
  },
  {
    match: "中南大学",
    variations: [
      {
        zh: "左家垅男子职业技术学校，湖大的风景，中南的工地",
        en: "Zuojialong men's vocational—Hunan U has the views, Central South has the construction dust.",
      },
    ],
  },
  {
    match: "西安交通大学",
    variations: [
      {
        zh: "西安沙坡村职业技术学院，西交的学风是“你卷我比你更卷”",
        en: "Shapocun vocational college—school spirit is 'you grind? I grind harder.'",
      },
    ],
  },
  {
    match: "西北工业大学",
    variations: [
      {
        zh: "友谊西路附小，低调到百度都要搜两次才确认它是985",
        en: "Youyi West Road elementary annex—so low-key Baidu needs two searches to confirm Project 985.",
      },
    ],
  },
  {
    match: "长安大学",
    variations: [
      {
        zh: "小寨大兴善寺走读学校，全国最没存在感的211，没有之一",
        en: "Xiazhai temple day school—the most forgettable 211 in China, bar none.",
      },
    ],
  },
  {
    match: "明治大学",
    variations: [{ zh: "maki的学校", en: "Meiji University—Maki's school." }],
  },

  // —— 华语独立 / 摇滚梗（整段输入乐队名触发）——
  {
    match: "万青",
    variations: [
      {
        zh: "每一个听万青的人手机里都有一张石家庄火车站的照片，配文“如此生活三十年”",
        en: "Every Omnipotent Youth Society fan has a Shijiazhuang station pic captioned 'thirty years thus.'",
      },
    ],
  },
  {
    match: "草东没有派对",
    variations: [
      {
        zh: "没有派对，也没有人懂他，但他有草东",
        en: "No party, nobody gets them—but they've got Caodong.",
      },
    ],
  },
  {
    match: "落日飞车",
    variations: [
      {
        zh: "文艺b的催情剂，放一首《My Jinji》，下一秒就要开始接吻",
        en: "Sunset Rollercoaster—My Jinji as indie make-out fuel.",
      },
    ],
  },
  {
    match: "Deca Joins",
    variations: [
      {
        zh: "每天都在“颓”，但颓得很有质感，颓得像一部黑白电影",
        en: "Deca every day is defeat—stylish, monochrome, cinematic defeat.",
      },
    ],
  },
  {
    match: "康姆士",
    variations: [
      {
        zh: "歌词永远在“你”和“我”之间反复横跳，这就是爱情的本质",
        en: "Commune lyrics ping-pong between you and me—that's love.",
      },
    ],
  },
  {
    match: "告五人",
    variations: [
      {
        zh: "红了之后老粉开始嫌弃新粉，“我早就听《披星戴月的想你》了”",
        en: "Accusefive blew up; OGs gatekeep 'I knew Starry Sleepless first.'",
      },
    ],
  },
  {
    match: "新裤子",
    variations: [
      {
        zh: "老粉认为《生命因你而火热》之后的都是垃圾，但每次巡演还是抢票",
        en: "Old fans trash everything after Life Hot Because of You—still fight for tour tickets.",
      },
    ],
  },
  {
    match: "刺猬",
    variations: [
      {
        zh: "鼓手比主唱更有名，这就是乐队的魅力——每个人都是主角",
        en: "The drummer out-fames the singer—Hedgehog: everyone's the lead.",
      },
    ],
  },
  {
    match: "五条人",
    variations: [
      {
        zh: "喜欢在朋友圈发“农村拓哉”和“郭富县城”，并觉得自己很幽默",
        en: "Posting 'Rural Kimura' and 'Guo Fu County Town'—proud of the bit.",
      },
    ],
  },
  {
    match: "重塑雕像的权利",
    variations: [
      {
        zh: "看不起所有其他乐队，因为重塑的英文发音最标准",
        en: "Re-TROS side-eyes other bands—they've got the most 'standard' English.",
      },
    ],
  },
  {
    match: "Mandarin",
    variations: [
      {
        zh: "冲着Chace的脸去的，但嘴上说“我是听编曲的”",
        en: "Came for Chace's face; says 'I'm here for the arrangement.'",
      },
    ],
  },
  {
    match: "福禄寿",
    variations: [
      {
        zh: "深夜听《玉珍》哭到凌晨三点，第二天假装没事",
        en: "Weeping to Yuzhen at 3 a.m., fine by breakfast.",
      },
    ],
  },
  {
    match: "房东的猫",
    variations: [
      {
        zh: "文青入门级，标配帆布鞋、帆布包、和一个没人记得住的名字",
        en: "Landlady's Cat—starter indie: canvas shoes, tote, forgettable name.",
      },
    ],
  },
  {
    match: "声音玩具",
    variations: [
      {
        zh: "听声玩的人都很孤独，但孤独得很精致，像欧珈源的吉他一样绕来绕去",
        en: "Sound Toy fans: lonely but curated—Ou Jiayuan guitar spirals.",
      },
    ],
  },
  {
    match: "野外合作社",
    variations: [
      {
        zh: "听野合的人都觉得自己生活在南京，其实根本没去过",
        en: "Wild Cooperative stans think they live in Nanjing—never been.",
      },
      {
        zh: "听野合的人都觉得《台风》是中国摇滚史上最伟大的专辑，别人说没听过，他们就说“你不懂”",
        en: "Typhoon is China's greatest rock album—if you disagree, 'you wouldn't get it.'",
      },
    ],
  },
  {
    match: "海朋森",
    variations: [
      {
        zh: "听海朋森的人都在朋友圈发陈思江的照片，配文“我也想当吉他手”",
        en: "Hyptonics fans spam Chen Sijiang pics: 'I wanna be guitarist too.'",
      },
    ],
  },
  {
    match: "脏手指",
    variations: [
      {
        zh: "听脏手指的人觉得自己很朋克，但其实只是喝醉了在路边吐",
        en: "Dirty Fingers fan feels punk—actually drunk and puking curbside.",
      },
    ],
  },
  {
    match: "法兹",
    variations: [
      {
        zh: "听法兹的人会在控制器的循环里迷失自我",
        en: "Lost in the FAZZ controller loop.",
      },
    ],
  },
  {
    match: "惘闻",
    variations: [
      {
        zh: "听后摇的人都是文艺b中的文艺b，听惘闻的是后摇里的后摇",
        en: "Post-rock hipster squared—Wang Wen is post-rock of post-rock.",
      },
    ],
  },
  {
    match: "甜梅号",
    variations: [
      {
        zh: "听甜梅号的人已经老了，但他们不说",
        en: "Sugar Plum Ferry fans are old—they won't say it.",
      },
    ],
  },
  {
    match: "声音碎片",
    variations: [
      {
        zh: "听声音碎片的人都在思考人生，但思考了半天发现啥也没想明白",
        en: "Sound Fragment fans philosophize for hours—still nothing clicks.",
      },
    ],
  },
  {
    match: "梅卡德尔",
    variations: [
      {
        zh: "听梅卡德尔的人觉得自己是这个时代最后的良知，其实就是个愤青",
        en: "Mercader fans think they're the last conscience—mostly just angry youth.",
      },
    ],
  },
  {
    match: "海龟先生",
    variations: [
      {
        zh: "听海龟的人都很开心，但开心的原因是因为他们根本没听懂歌词在唱什么",
        en: "Mr. Sea Turtle fans are happy—mostly because they never parse the lyrics.",
      },
    ],
  },
  {
    match: "马赛克",
    variations: [
      {
        zh: "听马赛克的人都在假装自己是80年代迪斯科女王/王子，其实蹦迪的时候手脚完全不协调",
        en: "Mosaic fans cosplay '80s disco royalty—dance floor limbs disagree.",
      },
    ],
  },
  {
    match: "Chinese Football",
    variations: [
      {
        zh: "听国足的人都是emo男孩，输了比赛听国足，赢了比赛也听国足",
        en: "Chinese Football fans are emo boys—win or lose, they still cue the band.",
      },
    ],
  },
  {
    match: "缺省",
    variations: [
      {
        zh: "听缺省的人都在假装自己很shoegaze，但其实根本分不清吉他的音墙和噪音的区别",
        en: "Default pretend shoegaze—can't tell wall of guitar from plain noise.",
      },
    ],
  },
  {
    match: "the fin.",
    variations: [
      {
        zh: "听the fin.的人都觉得自己在日本街头漫步，其实连日本都没去过",
        en: "the fin. fans stroll Shibuya in their heads—never stamped a Japan visa.",
      },
    ],
  },
  {
    match: "Suchmos",
    variations: [
      {
        zh: "听Suchmos的人觉得Citypop复兴全靠他们，但主唱退团之后就没人再提了",
        en: "Suchmos carried City pop revival—until the singer left, then silence.",
      },
    ],
  },
  {
    match: "Yogee New Waves",
    variations: [
      {
        zh: "听Yogee的人觉得Suchmos太商业了，Yogee才是真Citypop",
        en: "Yogee stans call Suchmos sellout—Yogee is 'real' City pop.",
      },
    ],
  },
  {
    match: "Lamp",
    variations: [
      {
        zh: "听Lamp的人都是文艺b中的小清新，下雨天必听《雨足はやく》，配一杯手冲咖啡",
        en: "Lamp fans: drizzle, Ameashi Hayaku, pour-over—soft indie starter pack.",
      },
    ],
  },
  {
    match: "Toe",
    variations: [
      {
        zh: "听后摇数学摇滚的人都说自己最喜欢的乐队是Toe，但问他们《For Long Tomorrow》第几分钟鼓手换了节奏，没人答得上来",
        en: "Everyone claims Toe—nobody knows when the drum pattern shifts on For Long Tomorrow.",
      },
    ],
  },
  {
    match: "LITE",
    variations: [
      {
        zh: "听LITE的人觉得Toe太慢了，LITE才是数学摇滚的速度与激情",
        en: "LITE fans: Toe is slow—LITE is math-rock Fast & Furious.",
      },
    ],
  },
  {
    match: "Mouse on the Keys",
    variations: [
      {
        zh: "听Mouse on the Keys的人都是爵士钢琴十级，或者假装自己是",
        en: "Mouse on the Keys fans—grade-10 jazz piano, or cosplay grade-10.",
      },
    ],
  },
  {
    match: "大象体操",
    variations: [
      {
        zh: "听大象体操的人都是贝斯手，或者暗恋贝斯手的人",
        en: "Elephant Gym fans are bassists—or crushing on one.",
      },
    ],
  },
  {
    match: "Rega",
    variations: [
      {
        zh: "听Rega的人都是鼓手，因为只有鼓手数得清拍子",
        en: "Rega fans are drummers—only drummers count that straight.",
      },
    ],
  },
  {
    match: "PK14",
    variations: [
      {
        zh: "听PK14的人都是中国后朋克的活化石，杨海崧的每句歌词都能背出来",
        en: "PK14 fans are Chinese post-punk fossils—Yang Haisong lines memorized.",
      },
    ],
  },
  {
    match: "P.K.14",
    variations: [
      {
        zh: "听完PK14的人都会沉默三秒钟，然后说“牛逼”，但其实没太听懂",
        en: "After PK14: three seconds silence, then 'sick'—still not sure what happened.",
      },
    ],
  },
  {
    match: "Carsick Cars",
    variations: [
      {
        zh: "听Carsick Cars的人都在等张守望砸吉他，砸完就觉得这张票值了",
        en: "Waiting for Zhang Shouwang to smash the guitar—then the ticket paid off.",
      },
    ],
  },
  {
    match: "Snapline",
    variations: [
      {
        zh: "听Snapline的人很少，但每个都觉得自己是少数派精英",
        en: "Few Snapline fans—each thinks they're the elite minority.",
      },
    ],
  },
  {
    match: "鸟撞",
    variations: [
      {
        zh: "听鸟撞的人都在等“第二张专辑”，等了十年了",
        en: "Birdstriking fans still waiting for album two—it's been a decade.",
      },
    ],
  },
  {
    match: "The Beatles",
    variations: [
      {
        zh: "听披头士的人分为两种：一种只听过《Hey Jude》，一种觉得《Revolver》之后的才是真披头士",
        en: "Beatles fans: Hey Jude tourists vs Revolver-and-after purists.",
      },
    ],
  },
  {
    match: "The Velvet Underground",
    variations: [
      {
        zh: "听地下丝绒的人都会告诉你“当年只卖了几百张，但每个买了的人都组了乐队”，仿佛他就是那几百分之一",
        en: "Velvet Underground lore: hundreds sold, every buyer started a band—sure, you're one of them.",
      },
    ],
  },
  {
    match: "Nirvana",
    variations: [
      {
        zh: "听涅槃的人都在27岁之前疯狂消费柯本，27岁之后就沉默了",
        en: "Nirvana fans binge Cobain before 27—after that, quiet.",
      },
    ],
  },
  {
    match: "Radiohead",
    variations: [
      {
        zh: "听电台头的人分为三个层次：听《Creep》的入门级，听《OK Computer》的进阶级，听《Kid A》的大神级，大神级看不起前面所有人",
        en: "Radiohead ladder: Creep casuals, OK Computer adepts, Kid A gods—each tier sneers down.",
      },
    ],
  },
  {
    match: "Sonic Youth",
    variations: [
      {
        zh: "听音速青年的人都会调弦，因为他们的吉他没有一根弦是标准音",
        en: "Sonic Youth fans retune—no string left in standard pitch.",
      },
    ],
  },
  {
    match: "Joy Division",
    variations: [
      {
        zh: "听快乐分裂的人都很不快乐，但他们觉得这不叫抑郁，这叫“后朋克的忧郁”",
        en: "Joy Division fans are miserable—call it post-punk melancholy, not depression.",
      },
    ],
  },
  {
    match: "The Smiths",
    variations: [
      {
        zh: "听史密斯的人都是单身，因为没有人能比莫里西更会写“我好惨”",
        en: "Smiths fans stay single—nobody pities like Morrissey.",
      },
    ],
  },
  {
    match: "The Cure",
    variations: [
      {
        zh: "听治疗的人化妆比女孩子还认真，眼线要画半个小时",
        en: "The Cure fans beat girls at eyeliner—half an hour minimum.",
      },
    ],
  },
  {
    match: "Pulp",
    variations: [
      {
        zh: "听Pulp的人都是普通人的代言人，因为贾维斯·科克就是普通人的神",
        en: "Pulp fans: Jarvis Cocker is god of the ordinary.",
      },
    ],
  },
  {
    match: "Blur",
    variations: [
      {
        zh: "听Blur的人觉得Oasis是民工听的，Oasis的粉丝觉得Blur是娘娘腔",
        en: "Blur thinks Oasis is for laborers; Oasis thinks Blur is soft.",
      },
    ],
  },
  {
    match: "Oasis",
    variations: [
      {
        zh: "听Oasis的人喝啤酒，听Blur的人喝手冲咖啡，这是阶级问题",
        en: "Oasis beer, Blur pour-over—class war in a cup.",
      },
    ],
  },
  {
    match: "Bob Dylan",
    variations: [
      {
        zh: "听迪伦的人都会吉他，因为不会弹吉他就没法假装自己是民谣歌手",
        en: "Dylan fans strum—can't folk-posture without a guitar.",
      },
    ],
  },
  {
    match: "Leonard Cohen",
    variations: [
      {
        zh: "听科恩的人都很老派，声音比他低八度，边听边抽烟",
        en: "Cohen fans go an octave lower—chain-smoking old souls.",
      },
    ],
  },
  {
    match: "Nick Cave",
    variations: [
      {
        zh: "听尼克·凯夫的人都在等坏种子，觉得死亡是一件很性感的事情",
        en: "Nick Cave fans wait for Bad Seeds—death as foreplay.",
      },
    ],
  },
  {
    match: "Tom Waits",
    variations: [
      {
        zh: "听汤姆·维茨的人嗓子都是哑的，因为跟着唱了十年",
        en: "Tom Waits fans rasp—they've sung along for a decade.",
      },
    ],
  },
  {
    match: "Sufjan Stevens",
    variations: [
      {
        zh: "听苏夫扬的人都是文艺b中的文艺b，每首歌都能写一篇五千字的听后感",
        en: "Sufjan fans write 5,000-word essays per song—meta hipsters.",
      },
    ],
  },
  {
    match: "Bon Iver",
    variations: [
      {
        zh: "听Bon Iver的人都在森林里的小木屋写过日记，虽然根本没去过森林",
        en: "Bon Iver cabin journals—forest never visited.",
      },
    ],
  },
  {
    match: "Beach House",
    variations: [
      {
        zh: "听Beach House的人都在做梦，梦醒了发现自己在出租屋里",
        en: "Beach House dreams—wake up in a rental box.",
      },
    ],
  },
  {
    match: "Slowdive",
    variations: [
      {
        zh: "听Slowdive的人都很慢，说话慢、走路慢、分手也慢",
        en: "Slowdive fans: slow talk, slow walk, slow breakups.",
      },
    ],
  },
  {
    match: "My Bloody Valentine",
    variations: [
      {
        zh: "听MBV的人耳朵都不太好，因为开太大声了",
        en: "MBV ears ring—volume as lifestyle.",
      },
    ],
  },
  {
    match: "Cocteau Twins",
    variations: [
      {
        zh: "听极地双子星的人都不知道伊丽莎白·弗雷泽在唱什么，但这就对了",
        en: "Cocteau Twins: no one knows Liz Fraser's words—and that's the point.",
      },
    ],
  },
  {
    match: "Mazzy Star",
    variations: [
      {
        zh: "听Mazzy Star的人都在等Hope Sandoval开口，开口的那一刻世界安静了",
        en: "Mazzy Star fans wait for Hope Sandoval—when she opens her mouth, the world hushes.",
      },
    ],
  },
  {
    match: "窦唯",
    variations: [
      {
        zh: "听窦唯的人分为两种：一种只听过《黑梦》，一种听《殃金咒》听到入定",
        en: "Dou Wei fans: Black Dream tourists vs Yan Jin Zhou trance monks.",
      },
    ],
  },
  {
    match: "张楚",
    variations: [
      {
        zh: "听张楚的人都在问“姐姐明天我要回家了吗”，但从来没回去过",
        en: "Zhang Chu fans ask 'Sister, can I go home tomorrow?'—never do.",
      },
    ],
  },
  {
    match: "何勇",
    variations: [
      {
        zh: "听何勇的人都在喊“姑娘姑娘漂亮漂亮”，喊完了发现自己还是单身",
        en: "He Yong fans shout 'pretty girls'—still single after the chant.",
      },
    ],
  },
  {
    match: "崔健",
    variations: [
      {
        zh: "听崔健的人都是老炮，一块红布蒙着眼睛走了三十年",
        en: "Cui Jian OGs—red cloth over the eyes for thirty years.",
      },
    ],
  },
  {
    match: "万能青年旅店",
    variations: [
      {
        zh: "听万青的人已经写过了，但值得再写一遍——他们手机里永远有石家庄站的照片",
        en: "OYS again—worth repeating: Shijiazhuang station pic forever in the camera roll.",
      },
    ],
  },

  // —— 美国 ——
  {
    match: "哈佛大学",
    variations: [
      {
        zh: "波士顿市郊总统政客预科班",
        en: "Presidential-prep in the Boston suburbs—half the jokes are about politics, not p-sets.",
      },
      {
        zh: "深红色（官方色，源自1858年滑艇比赛发红色围巾的应援传统）",
        en: "Crimson: official color from an 1858 boat race when fans waved red scarves.",
      },
    ],
  },
  {
    match: "斯坦福大学",
    variations: [
      {
        zh: "IT民工自我增值培训中心",
        en: "IT grunt self-improvement boot camp—Silicon Valley's favorite pipeline.",
      },
      {
        zh: "硅谷的黄埔军校，全校都在想着创业和IPO",
        en: "The Whampoa of Silicon Valley—everyone's sketching startups and IPOs.",
      },
      {
        zh: "红衣主教（Stanford Cardinal）",
        en: "Stanford Cardinal—the mascot and brand color rolled into one.",
      },
    ],
  },
  {
    match: "麻省理工学院",
    variations: [
      {
        zh: "书呆子共和国",
        en: "The Republic of Nerds—passport optional, problem sets mandatory.",
      },
      {
        zh: "就算是恶作剧也要写一篇论文说明技术原理",
        en: "Even a prank needs a paper explaining the engineering—it's that kind of place.",
      },
    ],
  },
  {
    match: "哥伦比亚大学",
    variations: [
      {
        zh: "Gossip Girl影视基地",
        en: "Gossip Girl film set—Upper East Side drama sold separately.",
      },
      {
        zh: "纽约最强婚介所（刘强东与奶茶妹妹在此结缘）",
        en: "NYC's strongest matchmaker—famous alumni couples get name-dropped in every tour.",
      },
      {
        zh: "华尔街的预备役，全纽约的实习机会都在等你",
        en: "Wall Street's farm team—every internship in the city seems one subway ride away.",
      },
    ],
  },
  {
    match: "芝加哥大学",
    variations: [
      {
        zh: "芝大，Where fun comes to die",
        en: '"Where fun comes to die"—UChicago\'s self-owning motto on the meme circuit.',
      },
      {
        zh: "全美最卷，没有之一，连快乐都是学术性的",
        en: "America's grind capital—even 'fun' has footnotes and a bibliography.",
      },
    ],
  },
  {
    match: "杜克大学",
    variations: [
      {
        zh: "全美体育特长生训练基地",
        en: "National training ground for varsity athletes—scholarship is the side quest.",
      },
      {
        zh: "篮球是信仰，学术是顺便",
        en: "Basketball is religion; academics are the elective.",
      },
    ],
  },
  {
    match: "康奈尔大学",
    variations: [
      { zh: "康村", en: "Cornell 'village'—middle-of-nowhere prestige." },
      {
        zh: "康奈尔位于伊萨卡，而伊萨卡位于山顶，而山顶位于纽约州的某个谁都找不到的地方",
        en: "Ithaca is on a hill, in a corner of New York nobody can find without GPS tears.",
      },
      {
        zh: "每天爬山上学，风雨无阻，四年下来人均登山运动员",
        en: "You climb to class daily—four years later you're basically an alpine athlete.",
      },
    ],
  },
  {
    match: "加州大学伯克利分校",
    variations: [
      {
        zh: "华裔书虫大学（University of Chinese Bookworms）",
        en: '"University of Chinese Bookworms"—library stacks as a second home.',
      },
      {
        zh: "全美最会抗议的大学，学生不是在游行就是在去游行的路上",
        en: "America's protest power user—either marching or en route to one.",
      },
      {
        zh: "金熊（官方昵称）",
        en: "Golden Bears—the official nickname that roars at every game.",
      },
    ],
  },
  {
    match: "加州大学洛杉矶分校",
    variations: [
      {
        zh: "白人被亚裔淹没的大学（University of Caucasians Lost Amongst Asians）",
        en: '"UC Lost Among Asians"—demographics drive the joke.',
      },
      {
        zh: "小亚洲加大（University of California Little Asia）",
        en: '"UC Little Asia"—Westwood eats well.',
      },
      {
        zh: "UCLA = You See Lots of Asians",
        en: '"You See Lots of Asians"—the acronym gag everyone repeats.',
      },
    ],
  },
  {
    match: "南加州大学",
    variations: [
      {
        zh: "被宠坏了的孩子们的大学（University of Spoiled Children）",
        en: '"University of Spoiled Children"—LA privilege in sweatshirt form.',
      },
      {
        zh: "被宠坏了的华裔学生大学（University of Spoiled Chinese）",
        en: "Spoiled-kid energy, Chinese diaspora edition—same campus, different meme.",
      },
      {
        zh: "学费贵到让人怀疑人生，但校友会说“值了，因为我们在洛杉矶”",
        en: "Tuition that hurts—alumni still say it's worth it because we're in LA.",
      },
    ],
  },
  {
    match: "加州大学尔湾分校",
    variations: [
      {
        zh: "华裔移民大学（University of Chinese Immigrants）",
        en: '"University of Chinese Immigrants"—Irvine demographics in one line.',
      },
      {
        zh: "无限期工程进行中（Under Construction Indefinitely）——校园永远在施工",
        en: "\"Under Construction Indefinitely\"—orange cones are the unofficial mascot.",
      },
    ],
  },
  {
    match: "加州大学圣地亚哥分校",
    variations: [
      {
        zh: "华裔的第二选择（University of Chinese Second Decision）",
        en: '"Second-choice U"—the meme when UCLA says no.',
      },
      {
        zh: "申UCLA没进的人都来了这里",
        en: "Everyone who missed UCLA landed here—and built their own beach myth.",
      },
    ],
  },
  {
    match: "伊利诺伊大学香槟分校",
    variations: [
      { zh: "玉米地", en: "The cornfield—flat, golden, and unforgettable." },
      {
        zh: "玉米地大到为了不让玉米挡阳光，图书馆建在地底下",
        en: "Corn so tall they put the library underground for sunlight.",
      },
      {
        zh: "UIUC = University of Indians and University of Chinese",
        en: '"Indians and Chinese"—demographic wordplay on the acronym.',
      },
    ],
  },
  {
    match: "普渡大学",
    variations: [
      {
        zh: "锅炉工（Boilermakers）",
        en: "Boilermakers—mascot name that sounds industrial on purpose.",
      },
      {
        zh: "普度众生——名字自带佛光，但其实是理工直男的天堂",
        en: "Sounds Buddhist; actually STEM bro heaven with aerospace on the résumé.",
      },
      {
        zh: "航空航天专业强到上过月球，但学校的画风依然是“烧锅炉的”",
        en: "Aerospace to the moon—brand still says 'we boil things.'",
      },
    ],
  },
  {
    match: "卡内基梅隆大学",
    variations: [
      {
        zh: "代码猴大学（Coding Monkey University）",
        en: '"Coding Monkey U"—CS majors dream in stack traces.',
      },
      {
        zh: "猴山，全校不是码代码就是在码代码的路上",
        en: "Monkey mountain—either shipping code or walking to coffee to ship code.",
      },
      {
        zh: "CS专业的学生连做梦都在debug",
        en: "CS students debug in their sleep—rubber duck optional.",
      },
    ],
  },
  {
    match: "俄勒冈大学",
    variations: [
      {
        zh: "鸭子大学",
        en: "Duck U—mascot first, questions later.",
      },
      {
        zh: "吉祥物是一只鸭子，但背后其实是独立战争英雄的后代",
        en: "The duck mascot nods to a Revolutionary War hero—yes, really.",
      },
    ],
  },

  // —— 英国 ——
  {
    match: "牛津大学",
    variations: [
      {
        zh: "无头大主教的老家",
        en: "Home of the headless bishop lore—Oxford loves a creepy library story.",
      },
      {
        zh: "最古老的英语大学，考试制度古老到让人怀疑穿越回了中世纪",
        en: "Oldest English-speaking uni—exam regs feel medieval on purpose.",
      },
      {
        zh: "圣约翰学院图书馆里，无头大主教威廉·劳德永远在找他的脑袋",
        en: "In St John's Library, Archbishop Laud still hunts for his head—in ghost-tour form.",
      },
    ],
  },
  {
    match: "剑桥大学",
    variations: [
      {
        zh: "漂浮头颅的母校",
        en: "Alma mater of floating heads—Cromwell's skull gets a walk-on.",
      },
      {
        zh: "克伦威尔的脑袋在校园里漂浮，四处寻找被斩首的身体",
        en: "Cromwell's head allegedly floats about looking for its body—tourists eat it up.",
      },
      {
        zh: "牛津的宿敌，两校划船比赛划了几百年，互相看不起",
        en: "Oxford's nemesis—boat race trash talk since forever.",
      },
    ],
  },
  {
    match: "圣安德鲁斯大学",
    variations: [
      {
        zh: "白衣女鬼出没地",
        en: "White lady ghost territory—Scottish gothic included in tuition.",
      },
      {
        zh: "英国王室的御用大学，威廉王子在这里认识了凯特王妃",
        en: "Royal meet-cute U—William and Kate era lore.",
      },
      {
        zh: "距离校园400米的教堂废墟中，每年10月到11月都有白衣女子飘荡",
        en: "Church ruins 400m away—October white-lady sightings on the brochure.",
      },
    ],
  },
  {
    match: "杜伦大学",
    variations: [
      {
        zh: "跳楼学霸的脚步声",
        en: "Footsteps of the fallen scholar—Durham's haunted room 21 story.",
      },
      {
        zh: "城堡是宿舍，上课像是在演《哈利·波特》",
        en: "Castle dorms—Potter LARP with real reading lists.",
      },
      {
        zh: "19世纪某学霸因成绩单被遮挡误以为自己挂科，跳楼后灵魂至今在21号房间踱步",
        en: "19th-c. grade panic, tragic jump—Room 21 still creaks in the tale.",
      },
    ],
  },
  {
    match: "伦敦政治经济学院",
    variations: [
      {
        zh: "伦敦金融城的预科班",
        en: "City of London pre-game—internships start year one.",
      },
      {
        zh: "全校都在卷投行实习，连大一新生都在写CV",
        en: "Everyone grinding for banking CVs—freshmen included.",
      },
      {
        zh: "LSE = Let's See Europe（脱欧前的老梗）",
        en: '"Let\'s See Europe"—pre-Brexit pun on the acronym.',
      },
    ],
  },
  {
    match: "伦敦大学学院",
    variations: [
      {
        zh: "伦敦大学学院 = UCL = University of Chinese Londoners",
        en: '"University of Chinese Londoners"—demographic humor in Bloomsbury.',
      },
      {
        zh: "G5中的“平易近人”担当，但其实录取率低到令人发指",
        en: "The 'approachable' G5—until you see the acceptance rate.",
      },
    ],
  },
  {
    match: "帝国理工学院",
    variations: [
      {
        zh: "伦敦最会搞钱的理工男聚集地",
        en: "London's finance-fluent STEM bro hive—Imperial in three words.",
      },
      {
        zh: "Imperial = 中国人比例高到教授以为自己在上海教书",
        en: "So many Chinese students profs joke they're teaching in Shanghai.",
      },
    ],
  },

  // —— 加拿大 ——
  {
    match: "多伦多大学",
    variations: [
      {
        zh: "紫色诅咒与马的睾丸",
        en: "Purple curse and the bronze horse's… remedy—classic frosh-week legend.",
      },
      {
        zh: "传说魔鬼诅咒了多大，只有一种“龌龊方法”能解除——亲吻爱德华七世雕像铜马的……某个部位",
        en: "Only one 'indecent' ritual lifts the devil's curse on U of T—ask a second year.",
      },
      {
        zh: "多大工程系的学生比其他专业更容易找到工作，因为他们掌握了这个秘密",
        en: "Engineers get jobs faster—they 'know the secret' of the statue, says the myth.",
      },
      {
        zh: "U of T = University of Tears（眼泪大学），final季全体学生一起哭",
        en: '"University of Tears"—finals week unites everyone in crying.',
      },
    ],
  },
  {
    match: "不列颠哥伦比亚大学",
    variations: [
      {
        zh: "全加拿大最美的校园，全加拿大最贵的学费",
        en: "Canada's prettiest campus, Canada's priciest tuition—Vancouver tax.",
      },
      {
        zh: "UBC = University of Billions of Chinese",
        en: '"Billions of Chinese"—demographic wordplay on the acronym.',
      },
    ],
  },

  // —— 澳大利亚 ——
  {
    match: "墨尔本大学",
    variations: [
      {
        zh: "墨大 = 澳洲第一名校，但留学生占比高到像在开联合国会议",
        en: "Australia's prestige brand—UN Security Council vibes in the lecture hall.",
      },
    ],
  },
  {
    match: "悉尼大学",
    variations: [
      {
        zh: "哈利·波特楼是网红打卡地，本校学生却挤不进去拍照",
        en: "Harry Potter quad is an influencer trap—locals can't get a clean shot.",
      },
    ],
  },
  {
    match: "澳大利亚国立大学",
    variations: [
      {
        zh: "堪培拉大农村的孤独王者，整个城市唯一的存在感就是这所大学",
        en: "Canberra's lonely crown—ANU is basically the whole city's personality.",
      },
    ],
  },
  {
    match: "新南威尔士大学",
    variations: [
      {
        zh: "UNSW = U Never Sleep Well，赶due赶到头秃",
        en: '"U Never Sleep Well"—due dates own your hairline.',
      },
    ],
  },
  {
    match: "莫纳什大学",
    variations: [
      {
        zh: "挂科率全澳第一，教学楼都是用重修费盖的",
        en: "Australia's fail-rate memes—buildings paid for in retake fees, jokes say.",
      },
    ],
  },

  // —— 亚洲及其他 ——
  {
    match: "新加坡国立大学",
    variations: [
      {
        zh: "NUS = NUS（NUS是亚洲第一，但亚洲第一到底有几所？）",
        en: "Asia's #1—but how many schools claim that title? NUS meta-meme.",
      },
    ],
  },
  {
    match: "南洋理工大学",
    variations: [
      {
        zh: "云南园职业技术学院（因其校园位于前“云南园”地块）",
        en: "\"Yunnan Garden Vocational College\"—named for the old Yunnan Garden site.",
      },
    ],
  },
  {
    match: "东京大学",
    variations: [
      {
        zh: "本乡的赤门是东京的景点，本校学生说“哦，那是我们校门”",
        en: "The Akamon is a Tokyo landmark—students shrug: oh, that is our gate.",
      },
    ],
  },
  {
    match: "香港大学",
    variations: [
      {
        zh: "辫子姑娘的幽魂，深夜小径上无脸的女鬼在问“有人愿意和我说话吗”",
        en: "Braid-girl ghost on the path—HKU's most famous spooky urban legend.",
      },
    ],
  },
  {
    match: "香港中文大学",
    variations: [
      { zh: "马料水大学", en: "Ma Liu Shui U—CUHK's geography meme by the MTR stop." },
      {
        zh: "马料水女子夜校（部分专业男女比例严重失调）",
        en: "Ma Liu Shui 'girls night school'—some majors skew the gender ratio hard.",
      },
      {
        zh: "颓大（校园在山上，上课像逛街，标配拖鞋+T恤+宿舍衫）",
        en: "The 'slouch' uni—hillside campus, flip-flops, dorm tee, class feels like a stroll.",
      },
      {
        zh: "穿高跟鞋和裙子去上课？别人会问“今晚约人了？又去酒吧？”",
        en: "Heels or a dress to lecture? People assume you have a hot date or bar plans.",
      },
      {
        zh: "校园大到占了一座山，谈恋爱要翻山越岭",
        en: "A whole mountain of campus—dating means hiking between colleges.",
      },
      {
        zh: "男女比例接近5:5，但“女子夜校”这个外号就是甩不掉了",
        en: "Roughly 50:50 now, but the 'girls night school' nickname stuck anyway.",
      },
    ],
  },
  {
    match: "香港科技大学",
    variations: [
      { zh: "火鸡大学", en: "Turkey U—HKUST's bird mascot meme." },
      {
        zh: "清水湾男子职业技校（男生多，来了就要做好无法脱单的准备）",
        en: "Clear Water Bay men's vocational—skewed male intake, dating optional.",
      },
      {
        zh: "校园地标是红色日晷，长得像火鸡（凤凰），所以叫火鸡大学",
        en: "Red sundial landmark looks like a turkey (or phoenix)—hence the name.",
      },
      {
        zh: "前校长陈繁昌在演讲中自称“火鸡”成员，官方认证",
        en: "Ex-president Tony Chan called himself a 'turkey' member—official canon.",
      },
      {
        zh: "创校初期内地职员粤语不标准，“科技”说成“火鸡”，外号就这么来的",
        en: "Early staff Cantonese: 'science & tech' sounded like 'turkey'—nickname born.",
      },
      {
        zh: "黄仁勋2024年去领荣誉博士时还拿“火鸡”梗开玩笑，口误说成“危机”",
        en: "Jensen Huang joked about 'turkey' at his 2024 honorary doctorate—and slipped to 'crisis.'",
      },
    ],
  },
  {
    match: "香港理工大学",
    variations: [
      { zh: "红磡技校", en: "Hung Hom vocational—PolyU in one line." },
      {
        zh: "香港王里工大学——校徽上的“里”字是歪的，像要掉下来",
        en: "'Wong Lei Gong'—the crooked 里 on the crest looked ready to fall off.",
      },
      {
        zh: "香港歪理大学（网民玩谐音梗）",
        en: "'Wrong-reason university'—Cantonese pun on the name.",
      },
      {
        zh: "“里”字后来被用胶纸扶正了，但外号留下了",
        en: "They taped the character straight—the jokes stayed crooked.",
      },
    ],
  },
  {
    match: "香港城市大学",
    variations: [
      { zh: "神大", en: "God U—CityU forum lore." },
      {
        zh: "上帝直属大学（God Affiliated University）",
        en: "God Affiliated University—when hype meets irony.",
      },
      {
        zh: "因为城大“打手”在各论坛疯狂刷屏宣传城大，芝麻绿豆小事都当世纪大事，被网友讽刺“世上无大学比得上，只有神可以相提并论”",
        en: "Boosters spam every forum—tiny wins as miracles—so netizens say only God rivals CityU.",
      },
      {
        zh: "九龙塘又一城附属大学（校园连着商场，学生下课直接逛街）",
        en: "Festival Walk annex—class ends, escalator to the mall.",
      },
    ],
  },
  {
    match: "香港浸会大学",
    variations: [
      { zh: "浸会中学", en: "Baptist Secondary—requirements feel like high school 2.0." },
      {
        zh: "全人教育冚家X——毕业要求多到像中学：要上IT课、体育课、普通话课",
        en: "Holistic education means IT, PE, Putonghua—like secondary school never ended.",
      },
      {
        zh: "强制修读Public Speaking，有教授自编教材200多元被质疑“收版税”",
        en: "Mandatory public speaking—prof's HK$200+ self-published reader raised royalty jokes.",
      },
      {
        zh: "“You and your health”被学生戏称“You and your hell”，堂堂大课最后只剩小猫三四只",
        en: "'You and your health' became 'hell'—mass lectures end with a handful of souls.",
      },
      {
        zh: "入学送学袍（其实是自己花钱买的），毕业变毕业袍，弄丢了要花几百块重买",
        en: "You buy the gown twice—lose it, pay hundreds to replace.",
      },
      {
        zh: "每天收到“Today@HKBU”邮件，标题说“Exciting Events”，学生内心：“Exciting你个头”",
        en: "Daily Today@HKBU: 'Exciting Events'—students read 'exciting my foot.'",
      },
      {
        zh: "全港唯一（和港中大）强制上体育课的大学，还要买PE衫",
        en: "One of two unis forcing PE kit—alongside CUHK.",
      },
    ],
  },
  {
    match: "香港教育大学",
    variations: [
      { zh: "教大", en: "EdUHK in two syllables." },
      {
        zh: "香港唯一一家“毕业即失业”有官方保障的大学——毕竟全港中小学教师岗位就那么多",
        en: "Only uni where 'graduate unemployment' is structurally guaranteed—finite teaching posts.",
      },
      {
        zh: "大埔墟女子师范学院（女生比例极高）",
        en: "Tai Po 'women's normal college'—very high female ratio.",
      },
    ],
  },
  {
    match: "岭南大学",
    variations: [
      { zh: "虎地大学", en: "Fu Tei U—Lingnan on the map." },
      {
        zh: "屯门山区避世修行基地，去一趟市区像出远门",
        en: "Tuen Mun hermit mode—a trip to town feels like a voyage.",
      },
      {
        zh: "全港最小校园，走一圈不用十分钟，但自称“小就是精致”",
        en: "Smallest HK campus—ten-minute lap—markets it as intimate.",
      },
    ],
  },
  {
    match: "香港演艺学院",
    variations: [
      {
        zh: "野鸡大学？（内地中介说的，但香港人不答应）",
        en: "'Diploma mill'? Mainland agents said it—Hong Kong disagrees hard.",
      },
      {
        zh: "亚洲第一表演艺术院校，全球前十，被内地中介说成“野鸡”引发港人愤怒",
        en: "Asia's top performing-arts school—global top ten—insulted by agents, locals rage.",
      },
      {
        zh: "GPA 3.0以上的专科生就能申请？门槛不高？——不好意思，录取看的是才华不是GPA",
        en: "Talent beats GPA—HKAPA auditions don't read like clearing-house rules.",
      },
      {
        zh: "知名校友：梁朝伟、黄秋生、王祖蓝、谢君豪——谁敢说这是野鸡？",
        en: "Alumni: Tony Leung, Anthony Wong, Wong Cho-lam, Tse Kwan-ho—call that a mill?",
      },
    ],
  },
  {
    match: "泰国国立法政大学",
    variations: [
      {
        zh: "血色电梯的诅咒，1976年大屠杀后电梯血迹永远洗不掉",
        en: "Blood-elevator curse—1976 trauma that won't fade from campus memory.",
      },
    ],
  },
  {
    match: "马来亚大学",
    variations: [
      {
        zh: "UM = 马大 = 马来西亚的“清北”，但留学生们还要和QS排名反复搏斗",
        en: "Malaysia's 'Tsinghua-Peking'—international students still fight the QS wars.",
      },
    ],
  },
];

export const UNIVERSITY_ROWS: UniRow[] = mergeUniversityNicknameSupplement(UNIVERSITY_ROWS_BASE);
