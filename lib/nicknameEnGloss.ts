/**
 * 将高校中文梗概译为简短英文说明（用于彩蛋 en 栏；非字对字翻译）。
 */
export function glossNicknameEn(zh: string): string {
  const t = zh.trim();
  if (!t) return "Chinese campus in-joke.";

  const rules: { re: RegExp; en: string }[] = [
    { re: /职业技术学院|男子职业技术|女子职业技术|专修学院|培训学校|师专|高专|专科|技术学院/, en: "Ironically nicknamed a ‘vocational college’—a classic Chinese forum roast of the school." },
    { re: /党校|干校|讲习所/, en: "Teasingly compared to a party cadre school—online slang about campus ethos." },
    { re: /野猪/, en: "Wild boars on campus—a viral student joke." },
    { re: /男女比例|男生|女生多到|男子|女子学院|女专|尼姑庵/, en: "Gender-ratio / dating-scene banter about the campus." },
    { re: /樱花|游客/, en: "Tourism + cherry blossoms crowding campus—a meme among students." },
    { re: /地铁|进城|一小时|偏远|村里|农村|郊区/, en: "Distance-to-downtown / ‘we’re in the boonies’ gag." },
    { re: /谈恋爱|恋爱|情侣|异地恋/, en: "Dating-on-campus joke: distance, ratios, or no time to date." },
    { re: /卷|刷题|科研|实验室/, en: "Grind culture / academics—self-roast about workload." },
    { re: /食堂|吃饭|酸奶|海底捞|服务好/, en: "Food / cafeteria culture meme." },
    { re: /修路|桥梁|土木|工地|搬砖|施工/, en: "Civil-engineering / construction-site nicknaming." },
    { re: /电力|邮电|码农|编程|写代码/, en: "STEM / IT student stereotype—online nickname." },
    { re: /冬天|风雪|风沙|极限挑战/, en: "Winter / weather struggle on campus." },
    { re: /211|985|双一流|二本|野鸡/, en: "Ranking / reputation banter (211/985 etc.)." },
    { re: /香港|港|粤语|岭南|九龙|屯门/, en: "Hong Kong campus lore / Cantonese pun." },
    { re: /上海|五角场|闵行|松江|嘉定|宝山|普陀|徐汇/, en: "Shanghai locality roast." },
    { re: /北京|中关村|五道口|魏公村|学院路|积水潭|昌平|明光村/, en: "Beijing neighborhood nickname." },
    { re: /武汉|珞珈|南湖|关山口|广埠屯|茶山刘|538/, en: "Wuhan campus geography meme." },
    { re: /南京|浦口|仙林|九龙湖|随园|孝陵卫/, en: "Nanjing area in-joke." },
    { re: /成都|郫县|二仙桥|川大|锦江/, en: "Sichuan / Chengdu campus slang." },
    { re: /西安|沙坡|秦岭|北雷|长安/, en: "Shaanxi / Xi’an student nickname." },
    { re: /东北|长春|沈阳|大连|哈尔滨/, en: "Northeast China campus roast." },
    { re: /济南|青岛|黄岛|兴隆山/, en: "Shandong locality gag." },
    { re: /广州|深圳|珠海|厦门|汕头|顺德/, en: "South China / Greater Bay meme." },
    { re: /杭州|西湖|紫金港|三墩/, en: "Hangzhou / Zhejiang campus joke." },
    { re: /合肥|芜湖|斛兵塘/, en: "Anhui campus nickname." },
    { re: /南昌|江西|瑶湖/, en: "Jiangxi campus slang." },
    { re: /福州|仓山|福建/, en: "Fujian campus nickname." },
    { re: /郑州|河南|铁塔/, en: "Henan higher-ed banter." },
    { re: /岳麓|左家垌|湘雅|长沙/, en: "Hunan campus lore." },
    { re: /兰州|榆中|西北|银川|新疆|西藏|青海|宁夏|内蒙|海南|昆明|贵阳|南宁|广西/, en: "Regional nickname for this university (Chinese web humor)." },
  ];

  for (const { re, en } of rules) {
    if (re.test(t)) return en;
  }
  return "Chinese internet nickname / campus in-joke (see Chinese line).";
}
