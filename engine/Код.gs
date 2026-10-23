/**
 * ХРОНИКА ГОСУДАРСТВА — Google Apps Script
 * Версия 15.1. Оформление «Королевская казна» на всех листах, лист «Армия», подсказки при наведении, модификаторы.
 * 15.1: тот же код работает и внутри таблицы, и в «Движке» (отдельный проект, ход с сайта). Таблицы v15 менять не нужно.
 */

// ============================================================
// ТАБЛИЦА И ЕЁ СВОЙСТВА (внутри таблицы — она сама, в Движке — та, что открыл Движок)
// ============================================================
var ENGINE_SS_ = null;
function SS_() { return ENGINE_SS_ || SpreadsheetApp.getActiveSpreadsheet(); }
// У отдельного проекта нет свойств документа: Движок хранит их в свойствах скрипта с ключом по ID таблицы.
function DOCPROPS_() {
  if (!ENGINE_SS_) { const p = PropertiesService.getDocumentProperties(); if (p) return p; }
  const sp = PropertiesService.getScriptProperties(), pre = "doc:" + SS_().getId() + ":";
  const o = {
    getProperty: (k) => sp.getProperty(pre + k),
    setProperty: (k, v) => { sp.setProperty(pre + k, String(v)); return o; },
    setProperties: (m) => { Object.keys(m).forEach((k) => sp.setProperty(pre + k, String(m[k]))); return o; },
  };
  return o;
}
// Всплывашка видна только в открытой таблице; из Движка её просто пропускаем.
function toast_(ss, msg, title, sec) { if (ENGINE_SS_) return; try { ss.toast(msg, title, sec); } catch (e) {} }

// ============================================================
// ДАННЫЕ
// ============================================================
// [Категория, Название, Рем, Мон, Требует, Цепочка, Показатель, Прибыль, БазЛимит]
const BUILDINGS = [
  ["Сельское х-во","Пасека",80,300,"","","еда","=D4/10/3*150",10],
  ["Сельское х-во","Птичник",100,450,"","","еда","=D5/10/3*150",10],
  ["Сельское х-во","Овчарня",120,510,"","","еда","=D6/10/3*300",10],
  ["Сельское х-во","Ферма",150,570,"","","еда","=D7/10/3*300",15],
  ["Сельское х-во","Мельница",180,600,"","Ферма","еда","=D8/10/3*300",10],
  ["Сельское х-во","Виноградник",200,750,"","","еда","=D9/10/3*300",8],
  ["Сельское х-во","Амбар",220,780,"","","еда","=D10/10/3*300",5],
  ["Сельское х-во","Рыбный промысел",240,810,"","","еда","=D11/10/3*300",8],
  ["Сельское х-во","Сыроварня",260,900,"","","еда","=D12/10/3*300",8],
  ["Сельское х-во","Скотоводня",320,1200,"","","еда","=D13/10/3*300",8],
  ["Сельское х-во","Водяная мельница",380,1410,"","Мельница","еда","=D14/10/3*500",5],
  ["Сельское х-во","Ветряная мельница",420,1500,"","Мельница","еда","=D15/10/3*500",5],
  ["Сельское х-во","Ирригация",550,2100,"","Амбар","еда","=D16/10/3*500",3],
  ["Сельское х-во","Оранжерея",750,2700,"Соль 1","","еда","=D17/10/3*1000",2],
  ["Сельское х-во","Зерновой резерв",950,3300,"Соль 1","Ирригация","еда","=D18/10/3*1000",1],
  ["Сельское х-во","Великая житница",1300,4200,"Соль 2","Зерновой резерв","еда","=D19/10/3*1000",1],
  ["Ремесло","Кожевня",120,400,"","","ремесло","=C20/3",10],
  ["Ремесло","Лесопилка",150,470,"","","ремесло","=C21/3",10],
  ["Ремесло","Кузница",180,550,"","","ремесло","=C22/3",10],
  ["Ремесло","Ткацкая мастерская",210,600,"","","ремесло","=C23/3",10],
  ["Ремесло","Гончарная мастерская",240,700,"","","ремесло","=C24/3",8],
  ["Ремесло","Мастерская",300,1000,"","","ремесло","=C25/3",8],
  ["Ремесло","Кирпичный завод",360,1100,"","Кузница","ремесло","=C26/3",5],
  ["Ремесло","Угольная яма",420,1200,"","","ремесло","=C27/3",5],
  ["Ремесло","Плавильня",450,1700,"уголь 1","Кузница","ремесло","=C28/3",5],
  ["Ремесло","Стекольная мастерская",510,1800,"уголь 1","","ремесло","=C29/3",4],
  ["Ремесло","Ювелирная мастерская",570,2000,"камни 1","","ремесло","=C30/3",4],
  ["Ремесло","Оружейная мастерская",600,2200,"железо 1","Мастерская","ремесло","=C31/3",4],
  ["Ремесло","Бронная мастерская",660,2400,"железо 1","Мастерская","ремесло","=C32/3",4],
  ["Ремесло","Мануфактура",810,3000,"уголь 1, железо 1","Мастерская","ремесло","=C33/3",3],
  ["Ремесло","Литейный цех",1200,3800,"уголь 2, железо 2","Плавильня","ремесло","=C34/3",2],
  ["Ремесло","Великая мастерская",1800,6500,"уголь 3, железо 3","Мануфактура","ремесло","=C35/3",1],
  ["Торговля","Таверна",80,300,"","","торговля","=D36/3",15],
  ["Торговля","Постоялый двор",120,450,"","","торговля","=D37/3",12],
  ["Торговля","Рынок",160,600,"","","торговля","=D38/3",10],
  ["Торговля","Лавка ростовщика",180,900,"","","торговля","=D39/3",8],
  ["Торговля","Склад",200,990,"","Рынок","торговля","=D40/3",8],
  ["Торговля","Ярмарка",250,1200,"","Рынок","торговля","=D41/3",6],
  ["Торговля","Караван-сарай",300,1371,"","","торговля","=D42/3",5],
  ["Торговля","Оптовый рынок",350,1455,"","Ярмарка","торговля","=D43/3",4],
  ["Торговля","Гильдия",400,1650,"","Ярмарка","торговля","=D44/3",3],
  ["Торговля","Таможня",450,1800,"","Склад","торговля","=D45/3",3],
  ["Торговля","Торговый пост",500,2100,"","Караван-сарай","торговля","=D46/3",3],
  ["Торговля","Ломбард",600,2400,"Драг. камни 1","Лавка ростовщика","торговля","=D47/3",2],
  ["Торговля","Фактория",750,3000,"","Торговый пост","торговля","=D48/3",2],
  ["Торговля","Биржа",1000,4155,"Золото 1, Драг камни 1","Гильдия","торговля","=D49/3",1],
  ["Торговля","Банк",1200,4500,"Золото 1, Драг камни 1","Ломбард","торговля","=D50/3",2],
  ["Торговля","Порт",1400,6000,"Шелк 1","","торговля","=D51/3",2],
  ["Торговля","Великая гавань",2500,9000,"Шелк 3","Порт","торговля","=D52/3",1],
  ["Религия","Молельня",60,250,"","","клирика","5.0",20],
  ["Религия","Алтарь",100,400,"","","клирика","15.0",15],
  ["Религия","Часовня",150,550,"","Алтарь","клирика","15.0",10],
  ["Религия","Скит",180,650,"","","клирика","12.0",8],
  ["Религия","Храм",250,900,"","Часовня","клирика","16.0",8],
  ["Религия","Паломнический центр",350,1300,"","Храм","клирика","12.5",5],
  ["Религия","Монастырь",400,1500,"","Скит","клирика","12.0",4],
  ["Религия","Религиозная школа",450,1700,"","Храм","клирика","8.0",4],
  ["Религия","Оракул",500,2000,"Благовония 1","Храм","клирика","7.0",2],
  ["Религия","Усыпальница",550,2200,"Благовония 1","","клирика","8.0",2],
  ["Религия","Собор",800,3200,"Благовония 2","Храм","клирика","10.0",2],
  ["Религия","Храм-крепость",1000,4000,"Благов. 2 Железо 2","Храм","клирика","5.0",1],
  ["Религия","Святилище",1200,4500,"Благовония 2","Собор","клирика","8.0",1],
  ["Религия","Великий собор",1800,7000,"Благовония 3","Собор","клирика","10.0",1],
  ["Религия","Пантеон",2500,10000,"Благовония 4","Великий собор","клирика","15.0",1],
  ["Военные","Сторожевой пост",150,500,"","","защита","0.1",10],
  ["Военные","Тренировочный лагерь",200,700,"","","призыв","0.05",5],
  ["Военные","Казармы",250,900,"","","призыв","0.1",5],
  ["Военные","Стрельбище",280,1000,"","Тренировочный лагерь","призыв","0.08",3],
  ["Военные","Сторожевая башня",300,1100,"","Сторожевой пост","кризисы","0.2",5],
  ["Военные","Конюшня",400,1400,"","","призыв","0.05",3],
  ["Военные","Арсенал",500,1700,"железо 1","Казармы","содержание","0.1",3],
  ["Военные","Осадный двор",600,2200,"железо 1","Арсенал","защита","0.2",2],
  ["Военные","Стены",700,2400,"","","защита","0.3",3],
  ["Военные","Цитадель",1500,5000,"железо 2, Драг. камни 2","Стены","защита","0.6",1],
  ["Военные","Крепость",2200,7500,"железо 3, Драг. камни 3","Цитадель","защита","0.8",1],
  ["Инфраструктура","Мосты",180,600,"","","торговля","0.05",5],
  ["Инфраструктура","Дороги",300,1000,"","","торговля","0.08",5],
  ["Инфраструктура","Острог",250,900,"","","единство","0.05",5],
  ["Инфраструктура","Госпиталь",350,1200,"","","кризисы","0.3",3],
  ["Инфраструктура","Канализация",400,1400,"","Госпиталь","кризисы","0.2",2],
  ["Инфраструктура","Бани",300,1100,"","","единство","0.05",3],
  ["Инфраструктура","Библиотека",550,2000,"","","ремесло","0.1",2],
  ["Инфраструктура","Архив",500,1800,"","Библиотека","единство","0.05",2],
  ["Инфраструктура","Ратуша",700,2500,"","","единство","0.08",2],
  ["Инфраструктура","Университет",1400,5000,"","Библиотека","ремесло","0.2",2],
  ["Инфраструктура","Обсерватория",900,3200,"","","клирика","4.0",2],
  ["Инфраструктура","Алхим. лаборатория",700,2600,"","","ремесло","0.1",2],
  ["Инфраструктура","Академия",2000,7000,"","Университет","ремесло","0.3",1],
  ["Магия","Дом мага",300,1100,"","","клирика","10.0",10],
  ["Магия","Скрипторий магии",500,1800,"камни 1","Дом мага","клирика","7.5",5],
  ["Магия","Круг силы",700,2600,"камни 2","","клирика","6.0",3],
  ["Магия","Башня магов",1000,3800,"камни 2","Скрипторий магии","клирика","9.0",3],
  ["Магия","Хранилище артефактов",1200,4500,"камни 3","Башня магов","клирика","5.0",2],
  ["Магия","Место силы",1500,5000,"камни 3","Круг силы","клирика","8.0",2],
  ["Магия","Магическая академия",2500,9000,"камни 4","Башня магов","клирика","6.0",1],
  ["Магия","Портал",3000,11000,"камни 4, уголь 3","Место силы","клирика","5.0",1]
];

const GODS = [
  ["ТВОРЦЫ", "", "", "", "", ""],
  ["Творец","Ксанатра","Мир, недра, экосфера","Конфликт с Вельзевулом","Официальная, дорогая","Защита земель, устойчивый прирост еды, крепкие недра"],
  ["Творец","Ямада","Жизнь, разумные расы","Конфликт с Вельзевулом","Официальная, дорогая","Прирост населения, +лояльность крестьян, +единство"],
  ["НАБЛЮДАТЕЛИ", "", "", "", "", ""],
  ["Наблюдатель","Вельзевул","Плодородие, урожай, опека","Враждует с Творцами","Свободная, дешевле","+еда, быстрые урожаи. Цена: -лояльность священников"],
  ["Наблюдатель","Владыка Леса","Лесные твари, монстры","Нейтрален","Свободная, дешевле","Звери-союзники, тайные тропы. Может потребовать странного"],
  ["МЁРТВЫЙ БОГ", "", "", "", "", ""],
  ["Мёртвый","Бинах иил Бина","Смерть","Уважаем всеми богами","Без затрат Клирики","Репутация, +единство. Разовые дары в час беды"]
];

const RESOURCES = [
  ["[Au] Золото", 0, "+200 монет в год", "Казна"],
  ["[Fe] Железо", 0, "-5% содержание армии, доступ к броне", "Армия"],
  ["[Gm] Драг. Камни", 0, "+5 лояльности феодалам, +0,1% единства", "Политика"],
  ["[Co] Уголь", 0, "+15% к ремеслу", "Ремесло"],
  ["[Sa] Соль", 0, "+10% эффективной еды, +5% снабжения", "Еда"],
  ["[In] Благовония", 0, "+1/+0,75/+0,5/+0,25 Клирики", "Клирика"],
  ["[Si] Шёлк", 0, "+15% торгового дохода", "Торговля"]
];

const EVENTS_CATALOG = [
  ["🧙","Странник с вестями","В столицу прибыл старик. Он видел, как на востоке горят деревни.",["Принять","Прогнать","В темницу"]],["⚔️","Стычка на границе","Патруль пересёкся с отрядом соседа. Есть раненые.",["Война","Компенсация","Замять"]],["💰","Клад на поле","Крестьянин нашёл горшок с монетами.",["В казну","Крестьянину","Храму"]],["🌾","Великий урожай","Поля дали небывалый урожай.",["Праздник","Продать","В амбары"]],["🐺","Волки в лесах","Стаи волков выходят к деревням.",["Облава","Охотники","Игнор"]],["⛪","Паломник","Странник утверждает, что видел чудо.",["Слово","Проверить","Изгнать"]],["💎","Заброшенная шахта","Найдена шахта с камнями. Вход завален.",["Расчистить","Закрыть","Местным"]],["🔥","Пожар в городе","Горит квартал ремесленников.",["Тушить","Эвакуация","Выгореть"]],["📜","Древний свиток","Свиток на неизвестном языке.",["Магам","Сжечь","Продать"]],["🗡️","Дуэль знати","Два барона сцепились. Один ранен.",["Казнить","Оправдать","Примирить"]],["🌙","Затмение","Солнце померкло. Народ в ужасе.",["Объяснить","Жрецы","Молчать"]],["👑","Пророк","Юродивый пророчит смерть правителя.",["Казнить","Выслушать","Изгнать"]],
  ["🐉","Дракон","Огромный дракон летает над деревнями.",["Рыцари","Заплатить","Игнор"]],["🌪","Смерч","Смерч уничтожил урожай.",["Помочь","Сами","Оставить"]],["🌊","Наводнение","Река вышла из берегов.",["Дамба","Эвакуация","Ждать"]],["☄️","Комета","Яркая комета в небе.",["Добрый знак","Дурной знак","Молчать"]],["🌋","Вулкан","Проснулся вулкан. Пепел на полях.",["Переселить","Оставить","Молиться"]],["⚡","Гроза века","Молнии подожгли амбары.",["Восстановить","Зерно","Ждать"]],["🌫","Туман","Туман не спадает неделю.",["Ждать","Вслепую","Праздник"]],["🌟","Звёздный дождь","Небо озарилось звёздным дождём.",["Праздник","Молчание","Жрецы"]],
  ["🦅","Гигантский орёл","Орёл унёс овец.",["Охотиться","Приманка","Игнор"]],["🐍","Гигантский змей","Змей пожирает скот.",["Убить","Охотник","Часть леса"]],["👹","Гоблины","Шайка гоблинов грабит деревни.",["Войско","Дань","Договор"]],["🐺","Оборотень","Поймали оборотня. Это кузнец.",["Казнить","Изгнать","Отпустить"]],["🦌","Белый олень","Олень приносит удачу.",["Охота","Священный","Забыть"]],["🐝","Пчелиный рой","Рой поселился в городе.",["Мёд","Прогнать","Храму"]],["🐋","Кит на берегу","Кит выбросился на берег.",["Мясо","В море","Богам"]],["🐴","Табун лошадей","Дикие лошади на равнине.",["Поймать всех","Часть","Оставить"]],["🦂","Скорпионы","Расплодились скорпионы.",["Выжечь","Яд","Оставить"]],
  ["📿","Святой отшельник","Отшельник в пустыне.",["В столицу","Игнор","Прогнать"]],["⛪","Религиозный спор","Монастыри спорят о догмате.",["Решить","Поддержать","Не вмешиваться"]],["🕯️","Чудо","Икона замироточила.",["Признать","Проверить","Запретить"]],["🔮","Пророчество","Юродивый произнёс пророчество.",["Записать","Забыть","Казнить"]],["👻","Призрак","В замке видели призрака.",["Освятить","Снести","Продать"]],["💀","Мертвецы","На кладбище восстали мертвецы.",["Сжечь","Освятить","Разобраться"]],["🧙","Маг-отступник","Маг практикует запретное.",["Схватить","Нанять","Изгнать"]],
  ["👑","Свадьба","Сосед предлагает династический брак.",["Согласиться","Отказать","Затянуть"]],["🗡️","Убийца","Покушение на придворного.",["Казнить","Допрос","Выкуп"]],["⚖️","Суд","Дворянин обвиняется в измене.",["Казнить","Оправдать","Сослать"]],["🏛️","Собрание","Горожане требуют собрания.",["Разрешить","Запретить","Позже"]],["📜","Хартия","Писцы предлагают свод законов.",["Принять","Отклонить","Отложить"]],["🕵️","Шпион","Пойман шпион соседа.",["Казнить","Перевербовать","Обменять"]],["💍","Союз","Родственник предлагает союз.",["Согласиться","Отказаться","Условия"]],["🎭","Театр","Театр высмеивает власть.",["Запретить","Во дворец","Игнор"]],["🎵","Бард","Бард хочет спеть о правителе.",["Принять","Прогнать","Заказать"]],
  ["💰","Купец","Прибыл богатый купец.",["Купить всё","Налог","Прогнать"]],["🧵","Шелкопряды","Найдены шелкопряды.",["Купить","Игнор","Продать"]],["🌶","Пряности","Караван привёз пряности.",["Знати","Продать","Оставить"]],["💎","Алмаз","Найден огромный алмаз.",["Продать","В корону","Храму"]],["⛏️","Обвал","Шахта обвалилась. 30 погибших.",["Спасать","Засыпать","Оставить"]],["🏭","Пожар","Мануфактура сгорела.",["Восстановить","Перенести","Оставить"]],["🍇","Виноград","Небывалый урожай винограда.",["Продать","Пир","Храму"]],
  ["🗝","Подземелье","Найдено подземелье с сокровищами.",["Отряд","Запечатать","Карту"]],["🏰","Крепость","Заброшенная крепость на границе.",["Восстановить","Снести","Забыть"]],["🧭","Путь","Найден древний торговый путь.",["Использовать","Засекретить","Игнор"]],["🌉","Мост","Мост обрушился.",["Новый","Восстановить","Ждать"]],["🏔️","Перевал","Снегопад закрыл перевал.",["Расчистить","Весны","В обход"]],["👽","Незнакомец","Прибыл незнакомец из-за моря.",["Принять","Изучить","Изгнать"]],["🎁","Подарок","Сосед прислал дары.",["Принять","Отказать","Ответить"]],["📯","Гонец","Гонец с востока о войне.",["Выслушать","Прогнать","Задержать"]],["🎨","Художник","Художник готов расписать храм.",["Согласиться","Отказать","Нанять"]],["📚","Книга","Книга на мёртвом языке.",["Магам","Сжечь","Продать"]],["🌲","Роща","Священная роща с духом.",["Освятить","Вырубить","Оставить"]]
];

// Палитра «Королевская казна»: фон, панели, тонкие линии, золото — акцент, светлый текст.
const C = { parchment:"#0B0907", parchmentDark:"#080605", bannerBg:"#15110B", panel:"#15110B", input:"#1D170E", dark:"#0B0907",
  ink:"#E8DCC0", text:"#E8DCC0", muted:"#A8956A", brown:"#2A2213", line:"#3A2F16", rule:"#5C4A1E",
  gold:"#E0B84A", green:"#8FC57A", red:"#E06A5A", yellow:"#E0B84A", darkRed:"#3A1410", greenBg:"#13240F", redBg:"#3A1410" };
const FONT_TITLE = "Forum", FONT_BODY = "EB Garamond", FONT_BAR = "Roboto Mono";

// ============================================================
// УТИЛИТЫ И МЕНЮ
// ============================================================
function onOpen() { buildExtendedMenu(); }
function buildExtendedMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Хроника").addItem("🆕 Инициализировать игру", "initGame").addSeparator().addItem("▶ Мастер хода", "openWizard").addItem("▷ Показать превью", "previewTurn").addSeparator()
    .addSubMenu(ui.createMenu("📋 Панели").addItem("👤 Панель игрока", "openPlayerPanel").addItem("👑 Панель админа", "openAdminPanel").addItem("🏰 Панель регионов", "openRegionsPanel"))
    .addSubMenu(ui.createMenu("🎲 События").addItem("Случайное событие", "rollEventFromMenu").addItem("Показать активные", "showActiveEvents"))
    .addSubMenu(ui.createMenu("⚙ Настройки").addItem("Настройки автостройки", "openSettings").addItem("Экспорт состояния", "exportGame").addItem("Импорт состояния", "importGame").addItem("🔒 Защитить листы", "protectGame").addItem("🔓 Снять защиту", "unprotectGame"))
    .addSubMenu(ui.createMenu("⏰ Автоматизация").addItem("Настроить триггеры", "setupTriggers").addItem("Сделать бэкап сейчас", "monthlyBackup"))
    .addSeparator().addItem("⟲ Пересчитать всё", "recalcAll").addItem("ⓘ Обновить подсказки", "refreshAll").addItem("ⓘ Помощь", "showHelp").addToUi();
}
function showHelp() { SpreadsheetApp.getUi().alert("ХРОНИКА ГОСУДАРСТВА\n\n▶ Мастер хода — пошаговое ведение хода.\n▷ Превью — расчёт без применения.\n📋 Панели — сводки.\n🎲 События — " + EVENTS_CATALOG.length + " случайных.\n\nⓘ — наведите мышь на подпись со значком: всплывёт расшифровка числа. Подсказки обновляются каждый ход и по меню «ⓘ Обновить подсказки».\n«Армия» — отряды; мощь и содержание считаются сами, коэффициенты — в справочнике внизу листа.\n\nДоход за ход: «Бюджет стройки» % — в фонд стройки, остальное — на склад и в казну."); }

function styleBanner(ws, row, c1, c2, text) {
  const rng = ws.getRange(row, c1, 1, c2 - c1 + 1); rng.merge(); ws.getRange(row, c1).setValue(text);
  const top = row === 1;
  rng.setBackground(C.parchment).setFontColor(C.gold).setFontFamily(FONT_TITLE).setFontSize(top ? 16 : 11).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle").setBorder(false, false, true, false, false, false, top ? C.rule : C.line, SpreadsheetApp.BorderStyle.SOLID);
  if (top) ws.setRowHeight(row, 40);
}
function styleOrnament(ws, row) { ws.setRowHeight(row, 8); }
function styleHeaderRow(ws, row, c1, c2) {
  ws.getRange(row, c1, 1, c2 - c1 + 1).setBackground(C.panel).setFontColor(C.muted).setFontFamily(FONT_TITLE).setFontSize(8).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setBorder(true, false, true, false, false, false, C.rule, SpreadsheetApp.BorderStyle.SOLID);
}
// Фон и цвет текста по умолчанию. Уже оформленные ячейки не трогает; за пределами области — тоже фон листа,
// чтобы новые строки (Хроника, Приказы) сразу были светлым текстом на тёмном.
function paintParchment(ws, mr, mc, color) {
  const base = color || C.parchment;
  const rng = ws.getRange(1, 1, mr, mc);
  const bg = rng.getBackgrounds(), fc = rng.getFontColors(), ff = rng.getFontFamilies();
  const dBg = x => !x || /^#?f{6}$/i.test(x) || x === "white";
  const dFc = x => !x || /^#?0{6}$/.test(x) || x === "black";
  const dFf = x => !x || x === "Arial";
  rng.setBackgrounds(bg.map(r => r.map(x => dBg(x) ? base : x)));
  rng.setFontColors(fc.map(r => r.map(x => dFc(x) ? C.text : x)));
  rng.setFontFamilies(ff.map(r => r.map(x => dFf(x) ? FONT_BODY : x)));
  const maxR = ws.getMaxRows(), maxC = ws.getMaxColumns();
  if (maxC > mc) ws.getRange(1, mc + 1, maxR, maxC - mc).setBackground(base).setFontColor(C.text).setFontFamily(FONT_BODY);
  if (maxR > mr) ws.getRange(mr + 1, 1, maxR - mr, mc).setBackground(base).setFontColor(C.text).setFontFamily(FONT_BODY);
}
// Ячейка (с объединением) + стиль. content: значение или формула (начинается с «=», пишется через F).
function stCell(ws, r, c, nc, content, st) {
  nc = nc || 1; st = st || {};
  const rng = ws.getRange(r, c, 1, nc); if (nc > 1) rng.merge();
  const cell = ws.getRange(r, c);
  if (st.font) rng.setFontFamily(st.font);
  if (st.size) rng.setFontSize(st.size);
  if (st.color) rng.setFontColor(st.color);
  if (st.bold) rng.setFontWeight("bold");
  if (st.align) rng.setHorizontalAlignment(st.align);
  rng.setVerticalAlignment(st.valign || "middle");
  if (st.fmt) rng.setNumberFormat(st.fmt);
  if (st.wrap) rng.setWrap(true);
  if (st.bg) rng.setBackground(st.bg);
  if (content !== undefined && content !== null && content !== "") {
    if (String(content).charAt(0) === "=") cell.setFormula(F(content)); else cell.setValue(content);
  }
  return cell;
}
// Подпись плашки; знак ⓘ подсвечивается золотом (у такой подписи есть всплывающее пояснение).
function infoLabel(ws, r, c, nc, text) {
  const rng = ws.getRange(r, c, 1, nc); if (nc > 1) rng.merge();
  rng.setFontFamily(FONT_TITLE).setFontSize(8).setFontWeight("bold").setFontColor(C.muted).setVerticalAlignment("bottom");
  const cell = ws.getRange(r, c); const i = text.indexOf("ⓘ");
  if (i < 0) cell.setValue(text);
  else cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(text).setTextStyle(i, i + 1, SpreadsheetApp.newTextStyle().setForegroundColor(C.gold).build()).build());
  return cell;
}
// Заголовок листа в стиле A: крупное название слева, счётчик справа (формула), золотая черта снизу.
function sheetTitle(ws, lastCol, title, counter, counterCols) {
  counterCols = counter ? (counterCols || 1) : 0;
  const tc = lastCol - counterCols;
  const t = ws.getRange(1, 1, 1, tc); if (tc > 1) t.merge();
  t.setBackground(C.parchment).setFontColor(C.gold).setFontFamily(FONT_TITLE).setFontSize(22).setFontWeight("bold").setHorizontalAlignment("left").setVerticalAlignment("middle");
  ws.getRange(1, 1).setValue(title);
  if (counter) {
    const k = ws.getRange(1, tc + 1, 1, counterCols); if (counterCols > 1) k.merge();
    k.setBackground(C.parchment).setFontFamily(FONT_TITLE).setFontSize(11).setFontColor(C.muted).setHorizontalAlignment("right").setVerticalAlignment("middle");
    ws.getRange(1, tc + 1).setFormula(F(counter));
  }
  ws.getRange(1, 1, 1, lastCol).setBorder(false, false, true, false, false, false, C.rule, SpreadsheetApp.BorderStyle.SOLID);
  ws.setRowHeight(1, 50);
}
// Подпись группы колонок над шапкой таблицы (строка 2).
function groupHead(ws, row, c, nc, text) {
  const g = ws.getRange(row, c, 1, nc); if (nc > 1) g.merge();
  g.setFontFamily(FONT_TITLE).setFontSize(9).setFontWeight("bold").setFontColor(C.gold).setHorizontalAlignment("center").setVerticalAlignment("bottom")
    .setBorder(false, false, true, false, false, false, C.rule, SpreadsheetApp.BorderStyle.SOLID);
  ws.getRange(row, c).setValue(text);
}
function colLetter(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? many : b === 1 ? one : (b >= 2 && b <= 4) ? few : many; }

function setPanel(ws, r, c, nr, nc) { ws.getRange(r, c, nr, nc).setBackground(C.panel).setBorder(true, true, true, true, false, false, C.line, SpreadsheetApp.BorderStyle.SOLID); }
function fmtN(x) { const v = Number(x) || 0; const n = Math.sign(v) * Math.round(Math.abs(v)); return (n < 0 ? "−" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function fmtD(x, d) { const n = Number(x) || 0; return (n < 0 ? "−" : "") + Math.abs(n).toFixed(d === undefined ? 1 : d).replace(".", ","); }
function fmtS(x, d) { const n = Number(x) || 0; const a = d ? Math.abs(n).toFixed(d).replace(".", ",") : fmtN(Math.abs(n)); return (n > 0 ? "+" : n < 0 ? "−" : "") + a; }
function F(s) { const locale = SS_().getSpreadsheetLocale(); if (!locale || locale.toLowerCase().startsWith("en")) return s; let out = s.replace(/\.(\d)/g, "§$1"); out = out.replace(/,/g, ";"); out = out.replace(/§/g, ","); if (!out.startsWith("= ")) out = "= " + out.substring(1); return out; }

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
function initGame() {
  const ss = SS_(); 
  const ui = SpreadsheetApp.getUi();
  
  if (ui.alert("Инициализация", "Все данные будут удалены. Продолжить?", ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // 1. Полная очистка
  const all = ss.getSheets(); 
  for (let i = all.length - 1; i >= 1; i--) { 
    try { ss.deleteSheet(all[i]); } catch(e) {} 
  }
  all[0].setName("_base_"); 
  all[0].clear();

  // 2. Создаем пустые листы
  const needed = ["Статистика", "Армия", "Ресурсы", "Пантеон", "Журнал", "Стройки", "Расчёты", "Регионы", "Модификаторы"];
  for (const name of needed) { 
    let sheet = ss.getSheetByName(name); 
    if (!sheet) { 
      try { sheet = ss.insertSheet(name); } catch(e) {} 
    } 
  }
  try { ss.deleteSheet(ss.getSheetByName("_base_")); } catch(e) {}

  // 3. ВАЖНО: Сначала создаем Регионы, чтобы формулы не ломались!
  try {
    ensureRegionsSheet(true); 
  } catch(e) {
    ui.alert("Ошибка создания Регионов:\n" + e.message);
    return;
  }

  // 4. Теперь заполняем остальные листы
  try { 
    fillStatsSheet(ss); 
    fillArmySheet(ss); 
    fillResourcesSheet(ss); 
    fillPantheonSheet(ss); 
    fillJournalSheet(ss); 
    fillBuildingsSheet(ss); 
    fillModifiersSheet(ss); 
    fillCalcSheet(ss); 
    ensureChronicleSheet(); 
    ensureEventsSheet(); 
    ensureOrdersSheet(); 
  } catch(e) { 
    ui.alert("Ошибка заполнения:\n" + e.message + "\n" + e.stack); 
    return; 
  }
  
  try { ss.getSheetByName("Расчёты").hideSheet(); } catch(e) {}
  try { SpreadsheetApp.flush(); refreshAll(); } catch(e) {}
  try { ss.setActiveSheet(ss.getSheetByName("Статистика")); } catch(e) {}
  
  ui.alert("Игра создана!");
}

// ============================================================
// ЛИСТ "СТАТИСТИКА"
// ============================================================
// ============================================================
// ЛИСТ "СТАТИСТИКА" — оформление «Королевская казна»
// ============================================================
// Сетка: A поле | B:C плашка | D зазор | E:F | G | H:I | J | K:L | M | N:O | P | Q:R | S поле
const ST_WIDTHS = [18, 96, 96, 10, 96, 96, 10, 96, 96, 10, 96, 96, 10, 96, 96, 10, 96, 96, 18];
const CRISES_INFO = [["Голод", 67, "Население −5%, ремесло −10%"], ["Бунт феодалов", 68, "Призыв −50%, единство −5"], ["Раскол", 69, "Религиозный раскол: ремесло −10%, торговля −10%"],
  ["Поветрие", 70, "Население −5%, ремесло −10%"], ["Набеги", 71, "Еда −10%, казна −10%, призыв −5%"], ["Опустошение", 72, "Опустошение земель: еда −15%, ремесло −15%"], ["Звери", 73, "Нападение диких зверей: еда −5%, население −2%"]];

function fillStatsSheet(ss) {
  const ws = ss.getSheetByName("Статистика"); ws.setHiddenGridlines(true);
  ST_WIDTHS.forEach((w, i) => ws.setColumnWidth(i + 1, w));
  paintParchment(ws, 30, 19);
  [[1, 14], [2, 18], [3, 44], [4, 14], [5, 22], [6, 40], [7, 22], [8, 14], [9, 26], [17, 14], [18, 26], [24, 14]].forEach(([r, h]) => ws.setRowHeight(r, h));
  const rules = [];

  // Шапка: название государства (вписывается вручную), ход и год
  stCell(ws, 2, 2, 11, "Х Р О Н И К А   Г О С У Д А Р С Т В А", { font: FONT_TITLE, size: 9, color: C.muted, valign: "bottom" });
  stCell(ws, 3, 2, 11, "[Название государства]", { font: FONT_TITLE, size: 24, bold: true, color: C.gold, valign: "bottom" });
  stCell(ws, 2, 14, 2, "ХОД", { font: FONT_TITLE, size: 9, color: C.muted, align: "right", valign: "bottom" });
  stCell(ws, 3, 14, 2, "=Расчёты!B154", { font: FONT_TITLE, size: 20, color: C.gold, align: "right", valign: "bottom", fmt: "0" });
  stCell(ws, 2, 17, 2, "ГОД", { font: FONT_TITLE, size: 9, color: C.muted, align: "right", valign: "bottom" });
  stCell(ws, 3, 17, 2, "=1200+Расчёты!B154", { font: FONT_TITLE, size: 20, color: C.gold, align: "right", valign: "bottom", fmt: "0" });
  ws.getRange(3, 2, 1, 17).setBorder(null, null, true, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID);

  // Шесть плашек: подпись / крупное число / изменение за ход
  const tiles = [
    [2, "НАСЕЛЕНИЕ ⓘ", "=Расчёты!B13", "#,##0", '=IF(Расчёты!B96>=0,"▲ +","▼ −")&FIXED(ABS(Расчёты!B96),0)&" за ход"'],
    [5, "КАЗНА ⓘ", "=Расчёты!B150", "#,##0", '=IF(Расчёты!B152>=0,"▲ +","▼ −")&FIXED(ABS(Расчёты!B152),0)&" за ход"'],
    [8, "СКЛАД РЕМЕСЛА ⓘ", "=Расчёты!B151", "#,##0", '=IF(Расчёты!B153>=0,"▲ +","▼ −")&FIXED(ABS(Расчёты!B153),0)&" за ход"'],
    [11, "ЕДА: ИЗЛИШЕК ⓘ", "=Расчёты!B23", "#,##0", '=FIXED(Расчёты!B21,0)&" − "&FIXED(Расчёты!B22,0)'],
    [14, "ЕДИНСТВО ⓘ", "=Расчёты!B39", '0.0"%"', '=REPT("█",ROUND(Расчёты!B39/10))&REPT("░",10-ROUND(Расчёты!B39/10))'],
    [17, "КЛИРИКА ⓘ", "=Расчёты!B105", "0.0", '="+"&ROUND(Расчёты!B103,1)&" за ход · "&LOWER(Расчёты!B107)']
  ];
  tiles.forEach(([c, label, value, fmt, sub]) => {
    setPanel(ws, 5, c, 3, 2);
    infoLabel(ws, 5, c, 2, label);
    stCell(ws, 6, c, 2, value, { font: FONT_TITLE, size: 20, color: C.gold, fmt: fmt });
    stCell(ws, 7, c, 2, sub, { font: c === 14 ? FONT_BAR : FONT_BODY, size: c === 14 ? 9 : 10, color: c === 14 ? C.gold : C.muted, valign: "top" });
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("▲").setFontColor(C.green).setRanges([ws.getRange("B7:R7")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("▼").setFontColor(C.red).setRanges([ws.getRange("B7:R7")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C.red).setRanges([ws.getRange("E6:L6")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("стабильно").setFontColor(C.green).setRanges([ws.getRange("Q7")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("предупреждение").setFontColor(C.gold).setRanges([ws.getRange("Q7")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("разрыв").setFontColor(C.red).setRanges([ws.getRange("Q7")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("вторжение").setFontColor(C.red).setRanges([ws.getRange("Q7")]).build());

  // Полоса 1: сословия, хозяйство, ресурсы (строки 9-16)
  [[2, "СОСЛОВИЯ"], [8, "ХОЗЯЙСТВО ЗА ГОД"], [14, "РЕСУРСЫ"]].forEach(([c, t]) => { setPanel(ws, 9, c, 8, 5); stCell(ws, 9, c, 5, t, { font: FONT_TITLE, size: 11, bold: true, color: C.gold }); });
  stCell(ws, 10, 2, 1, "СОСЛОВИЕ", { font: FONT_TITLE, size: 8, color: C.muted });
  stCell(ws, 10, 3, 1, "ЧИСЛО", { font: FONT_TITLE, size: 8, color: C.muted, align: "right" });
  infoLabel(ws, 10, 5, 2, "ЛОЯЛЬНОСТЬ ⓘ");
  ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"].forEach((name, i) => {
    const r = 11 + i;
    stCell(ws, r, 2, 1, name, { size: 11 });
    stCell(ws, r, 3, 1, `=Расчёты!B${14 + i}`, { size: 11, align: "right", fmt: "#,##0" });
    stCell(ws, r, 5, 1, `=REPT("█",ROUND(Расчёты!B${59 + i}/10))&REPT("░",10-ROUND(Расчёты!B${59 + i}/10))`, { font: FONT_BAR, size: 8, color: C.gold });
    stCell(ws, r, 6, 1, `=Расчёты!B${59 + i}`, { size: 11, align: "right", fmt: '0"%"' });
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(30).setFontColor(C.red).setRanges([ws.getRange("F11:F15")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(70).setFontColor(C.green).setRanges([ws.getRange("F11:F15")]).build());
  stCell(ws, 16, 2, 5, '="Прирост населения: "&IF(Расчёты!B95>=0,"+","")&ROUND(Расчёты!B95*100,1)&"% в ход · "&FIXED(Расчёты!B96,0)&" чел."', { size: 10, color: C.muted });

  [["Еда: производство", "=Расчёты!B21"], ["Еда: потребление", "=Расчёты!B22"], ["Ремесло", "=Расчёты!B26"], ["Доход монет", "=Расчёты!B31"], ["Содержание армии", "=Расчёты!B32"], ["Итог монет", "=Расчёты!B33"]].forEach(([n, f], i) => {
    const r = 10 + i; const last = i === 5;
    stCell(ws, r, 8, 3, n, { size: 11, color: last ? C.gold : C.text });
    stCell(ws, r, 11, 2, f, { size: 11, align: "right", fmt: "#,##0", color: last ? C.gold : C.text, bold: last });
    if (last) ws.getRange(r, 8, 1, 5).setBorder(true, null, null, null, null, null, C.line, SpreadsheetApp.BorderStyle.SOLID);
  });
  stCell(ws, 16, 8, 5, '="В фонд стройки "&Расчёты!B155&"%: "&FIXED(Расчёты!B158,0)&" рем. · "&FIXED(Расчёты!B159,0)&" мон."', { size: 10, color: C.muted });

  [["Au", "Золото"], ["Fe", "Железо"], ["Gm", "Драг. камни"], ["Co", "Уголь"], ["Sa", "Соль"], ["In", "Благовония"], ["Si", "Шёлк"]].forEach(([b, n], i) => {
    const r = 10 + i;
    stCell(ws, r, 14, 1, b, { font: FONT_TITLE, size: 8, bold: true, color: C.dark, bg: "#C9A646", align: "center" });
    stCell(ws, r, 15, 3, n, { size: 11 }).setNote(n + ": " + RESOURCES[i][2]);
    stCell(ws, r, 18, 1, `=Ресурсы!B${4 + i}`, { size: 11, align: "right" });
  });

  // Полоса 2: кризисы, войско, эффекты (строки 18-23)
  [[2, "КРИЗИСЫ"], [8, "ВОЙСКО"]].forEach(([c, t]) => { setPanel(ws, 18, c, 6, 5); stCell(ws, 18, c, 5, t, { font: FONT_TITLE, size: 11, bold: true, color: C.gold }); });
  setPanel(ws, 18, 14, 6, 5);
  const fx = ws.getRange(18, 14, 1, 5); fx.merge(); fx.setFontFamily(FONT_TITLE).setFontSize(11).setFontWeight("bold").setFontColor(C.gold).setVerticalAlignment("middle");
  ws.getRange(18, 14).setRichTextValue(SpreadsheetApp.newRichTextValue().setText("ЭФФЕКТЫ ⓘ").build());
  CRISES_INFO.forEach(([name, row, effect], i) => {
    const r = 19 + Math.floor(i / 2), c = i % 2 === 0 ? 2 : 5;
    stCell(ws, r, c, 2, `=IF(Расчёты!B${row}="ДА","⚠ ","")&"${name}"`, { size: 10, color: C.muted, align: "center" }).setNote(effect);
    ws.getRange(r, c, 1, 2).setBorder(true, true, true, true, null, null, C.line, SpreadsheetApp.BorderStyle.SOLID);
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("⚠").setBackground(C.redBg).setFontColor(C.red).setBold(true).setRanges([ws.getRange("B19:F22")]).build());
  stCell(ws, 23, 2, 5, '=IF(COUNTIF(Расчёты!B67:B73,"ДА")=0,"Спокойно. Активный кризис загорается красным.","Активных кризисов: "&COUNTIF(Расчёты!B67:B73,"ДА"))', { size: 10, color: C.muted });

  [["Призыв: специалисты", "=Расчёты!B42"], ["Призыв: сброд", "=Расчёты!B43"], ["В строю", "=Расчёты!B112"], ["Мощь армии", `=Армия!Q${ARMY_LAST + 1}`]].forEach(([n, f], i) => {
    stCell(ws, 19 + i, 8, 3, n, { size: 11 });
    stCell(ws, 19 + i, 11, 2, f, { size: 11, align: "right", fmt: "#,##0" });
  });
  const army = ss.getSheetByName("Армия");
  stCell(ws, 23, 8, 5, army ? `=HYPERLINK("#gid=${army.getSheetId()}","→ Подробно: лист «Армия»")` : "→ Подробно: лист «Армия»", { size: 10, color: C.gold });

  stCell(ws, 19, 14, 5, '=IF(COUNTIF(Модификаторы!C5:C104,"АКТИВЕН")=0,"Действующих модификаторов нет.",TEXTJOIN(CHAR(10),TRUE,ARRAYFORMULA(IF(Модификаторы!C5:C104="АКТИВЕН","• "&Модификаторы!A5:A104&IF(Модификаторы!H5:H104<>""," ("&Модификаторы!H5:H104&" х.)",""),""))))', { size: 10, wrap: true, valign: "top" });
  ws.getRange(19, 14, 5, 5).merge();
  for (let r = 19; r <= 23; r++) ws.setRowHeight(r, 22);
  ws.setConditionalFormatRules(rules);
}

// ============================================================
// ЛИСТ "РЕСУРСЫ"
// ============================================================
function fillResourcesSheet(ss) {
  const ws = ss.getSheetByName("Ресурсы"); ws.setHiddenGridlines(true);
  [220, 110, 340, 300, 130].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  paintParchment(ws, 20, 6);
  sheetTitle(ws, 5, "Хранилище ресурсов", '="ИСТОЧНИКОВ: "&SUM(B4:B10)');
  styleOrnament(ws, 2);
  ["РЕСУРС", "ИСТОЧНИКОВ", "ЗА 1 ИСТОЧНИК", "СЕЙЧАС ДАЁТ", "СФЕРА"].forEach((h, i) => ws.getRange(3, i + 1).setValue(h)); styleHeaderRow(ws, 3, 1, 5);
  ws.getRange(3, 1).setHorizontalAlignment("left");
  const now = ['=IF(B4>0,"+"&B4*200&" монет в год","—")', '=IF(B5>0,"−"&MIN(20,B5*5)&"% содержания армии","—")',
    '=IF(B6>0,"+"&B6*5&" лояльности феодалам · +"&B6*0.1&" единства","—")', '=IF(B7>0,"+"&MIN(30,B7*15)&"% ремесла","—")',
    '=IF(B8>0,"+"&MIN(20,B8*10)&"% еды","—")', '=IF(B9>0,"+"&(IF(B9>=1,1,0)+IF(B9>=2,0.75,0)+IF(B9>=3,0.5,0)+IF(B9>=4,0.25,0))&" клирики за ход","—")',
    '=IF(B10>0,"+"&MIN(30,B10*15)&"% торговли","—")'];
  RESOURCES.forEach((r, i) => {
    const row = 4 + i; const m = /^\[(\w+)\]\s*(.*)$/.exec(r[0]) || [null, "", r[0]];
    const label = m[1] + "   " + m[2];
    ws.getRange(row, 1).setFontFamily(FONT_BODY).setFontSize(12).setFontWeight("bold");
    ws.getRange(row, 1).setRichTextValue(richRuns(label, [[0, m[1].length, C.gold]]));
    ws.getRange(row, 2).setValue(r[1]);
    ws.getRange(row, 3).setNumberFormat("@").setValue(r[2]);
    ws.getRange(row, 4).setFormula(F(now[i]));
    ws.getRange(row, 5).setValue(r[3]);
  });
  const body = ws.getRange(4, 1, 7, 5);
  body.setVerticalAlignment("middle").setBorder(null, null, true, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  ws.setRowHeights(4, 7, 34);
  ws.getRange(4, 2, 7, 1).setBackground(C.input).setFontFamily(FONT_TITLE).setFontSize(16).setFontColor(C.gold).setHorizontalAlignment("center");
  ws.getRange(4, 3, 7, 1).setFontSize(11).setFontColor(C.muted).setFontFamily(FONT_BODY);
  ws.getRange(4, 4, 7, 1).setFontSize(11).setFontColor(C.green).setFontFamily(FONT_BODY);
  ws.getRange(4, 5, 7, 1).setFontSize(10).setFontColor(C.muted).setHorizontalAlignment("center").setFontFamily(FONT_BODY);
  ws.getRange(4, 2, 7, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).build());
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("—").setFontColor(C.rule).setRanges([ws.getRange("D4:D10")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setFontColor(C.muted).setRanges([ws.getRange("B4:B10")]).build()]);
}

// ============================================================
// ЛИСТ "ПАНТЕОН"
// ============================================================
// Боги — карточки, группы (Творцы, Наблюдатели, Мёртвый бог…) — колонки. Данные — список GODS.
function fillPantheonSheet(ss) {
  const ws = ss.getSheetByName("Пантеон"); ws.setHiddenGridlines(true);
  [16, 110, 260, 16, 110, 260, 16, 110, 260, 16].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  paintParchment(ws, 60, 10);
  sheetTitle(ws, 10, "Пантеон богов", '="КЛИРИКА: "&FIXED(Расчёты!B105,1)', 3);
  styleOrnament(ws, 2);
  const groups = []; GODS.forEach(g => { if (g[1] === "") groups.push({ title: g[0], gods: [] }); else if (groups.length) groups[groups.length - 1].gods.push(g); });
  const cols = [2, 5, 8], next = [3, 3, 3];
  const label = (r, c, t) => stCell(ws, r, c, 1, t, { font: FONT_TITLE, size: 8, bold: true, color: C.muted, valign: "top" });
  const groupTitle = (r, c, t) => { stCell(ws, r, c, 2, t, { font: FONT_TITLE, size: 11, bold: true, color: C.muted, valign: "bottom" }); ws.getRange(r, c, 1, 2).setBorder(null, null, true, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID); ws.setRowHeight(r, 30); };
  groups.forEach((gr, gi) => {
    const k = gi < 3 ? gi : next.indexOf(Math.min.apply(null, next)), c = cols[k]; let r = next[k];
    groupTitle(r, c, gr.title); r += 1;
    gr.gods.forEach(g => {
      setPanel(ws, r, c, 5, 2);
      stCell(ws, r, c, 2, g[1], { font: FONT_TITLE, size: 17, bold: true, color: C.gold, valign: "bottom" });
      stCell(ws, r + 1, c, 2, g[2], { size: 11, color: C.muted, valign: "top" }).setFontStyle("italic");
      [["ОТНОШЕНИЯ", g[3]], ["МОЛИТВА", g[4]], ["ДАР", g[5]]].forEach(([t, v], j) => {
        label(r + 2 + j, c, t);
        stCell(ws, r + 2 + j, c + 1, 1, String(v), { size: 11, wrap: true, valign: "top", fmt: "@",
          color: /Враждует/.test(String(v)) ? C.red : /Уважаем/.test(String(v)) ? C.green : C.text });
      });
      r += 6;
    });
    next[k] = r;
  });
  // Цена обращения — в самую короткую колонку
  const k = next.indexOf(Math.min.apply(null, next)), c = cols[k]; let r = next[k];
  groupTitle(r, c, "ЦЕНА ОБРАЩЕНИЯ"); r += 1;
  setPanel(ws, r, c, 4, 2);
  [["Прямой каст", "1 клирика", "риск"], ["Через бога", "2–3 клирики", "безопасно"], ["Разрешение бога", "5–20 клирики", "гарантия"]].forEach(([a, b, d], j) => {
    stCell(ws, r + j, c, 1, a, { size: 11, wrap: true });
    ws.getRange(r + j, c + 1).setRichTextValue(richRuns(b + "  · " + d, [[0, b.length, C.gold]]));
  });
  stCell(ws, r + 3, c, 2, "Клирика в минусе: −5 предупреждение, −10 разрыв, −20 вторжение.", { size: 10, color: C.muted, wrap: true });
}

// ============================================================
// ЛИСТ "ЖУРНАЛ" (12 колонок)
// ============================================================
// ЖУРНАЛ (18 колонок): A–L фонд стройки, M–O склад ремесла, P–R казна монет. Строка 2 — подписи групп колонок.
function fillJournalSheet(ss) {
  const ws = ss.getSheetByName("Журнал"); ws.setHiddenGridlines(true);
  sheetTitle(ws, 18, "Журнал ходов", '="ХОД "&Расчёты!B154', 2);
  ws.setRowHeight(2, 24);
  groupHead(ws, 2, 3, 8, "ФОНД СТРОЙКИ · РЕМЕСЛО / МОНЕТЫ"); groupHead(ws, 2, 13, 3, "СКЛАД РЕМЕСЛА"); groupHead(ws, 2, 16, 3, "КАЗНА");
  const h = ["ХОД", "НАСЕЛ.", "СТАРТ Р", "СТАРТ М", "+ Р", "+ М", "− Р", "− М", "КОНЕЦ Р", "КОНЕЦ М", "ПОСТРОЕНО", "ЗАМЕТКИ", "+ ПРИХОД", "− РАСХОД", "ИТОГ", "+ ПРИХОД", "− РАСХОД", "ИТОГ"];
  h.forEach((x, i) => ws.getRange(3, i + 1).setNumberFormat("@").setValue(x)); styleHeaderRow(ws, 3, 1, 18);
  ws.getRange(4, 1, 1, 18).setValues([[0, 50000, 0, 0, 0, 0, 0, 0, 0, 0, "", "Старт", 0, 0, 0, 0, 0, 0]]);
  for (let i = 5; i <= 34; i++) writeJournalFormulas(ws, i, i - 1);
  for (let i = 5; i <= 34; i++) {
    ws.getRange(i, 1).setValue(i - 4);
    [5, 6, 7, 8, 13, 14, 16, 17].forEach(c => ws.getRange(i, c).setValue(0));
  }
  styleJournalRows(ws, 4, 31);
  const all = (c1, c2) => ws.getRange(4, c1, 1997, c2 - c1 + 1);
  const rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=($B4<>"")*($B5="")>0').setBackground(C.input).setRanges([all(1, 18)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B4=""').setFontColor(C.rule).setRanges([all(1, 18)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setFontColor(C.muted).setRanges([all(3, 10), all(13, 18)]).build());
  ws.setConditionalFormatRules(rules);
  [52, 80, 70, 70, 64, 64, 64, 64, 76, 76, 150, 230, 72, 72, 82, 72, 72, 92].forEach((w, i) => ws.setColumnWidth(i + 1, w)); paintParchment(ws, 36, 18);
}

// Оформление строк Журнала: приходы зелёным, расходы красным, итоги золотом.
function styleJournalRows(ws, r, n) {
  ws.getRange(r, 1, n, 18).setFontFamily(FONT_BODY).setFontSize(11).setFontColor(C.text).setVerticalAlignment("middle")
    .setBorder(null, null, true, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  ws.getRange(r, 1, n, 1).setFontFamily(FONT_TITLE).setFontSize(12).setFontColor(C.gold).setHorizontalAlignment("center");
  [2, 3, 4, 9, 10].forEach(c => ws.getRange(r, c, n, 1).setNumberFormat("#,##0").setHorizontalAlignment("right"));
  [9, 10].forEach(c => ws.getRange(r, c, n, 1).setFontColor(C.gold));
  [5, 6, 13, 16].forEach(c => ws.getRange(r, c, n, 1).setNumberFormat('+#,##0;-#,##0;0').setFontColor(C.green).setHorizontalAlignment("right"));
  [7, 8, 14, 17].forEach(c => ws.getRange(r, c, n, 1).setNumberFormat('"−"#,##0;#,##0;0').setFontColor(C.red).setHorizontalAlignment("right"));
  [15, 18].forEach(c => ws.getRange(r, c, n, 1).setNumberFormat("#,##0").setFontColor(C.gold).setFontWeight("bold").setHorizontalAlignment("right"));
  ws.getRange(r, 12, n, 1).setFontColor(C.muted).setFontSize(10);
}

// Формулы переноса остатков в строке Журнала row (prev — предыдущая строка).
function writeJournalFormulas(ws, row, prev) {
  ws.getRange(row, 3).setFormula(F(`=I${prev}`));
  ws.getRange(row, 4).setFormula(F(`=J${prev}`));
  ws.getRange(row, 9).setFormula(F(`=C${row}+E${row}-G${row}`));
  ws.getRange(row, 10).setFormula(F(`=D${row}+F${row}-H${row}`));
  ws.getRange(row, 15).setFormula(F(`=O${prev}+M${row}-N${row}`));
  ws.getRange(row, 18).setFormula(F(`=R${prev}+P${row}-Q${row}`));
}

// ============================================================
// ЛИСТ "СТРОЙКИ" (Прибыль и специфические формулы)
// ============================================================
// ============================================================
// ЛИСТ "СТРОЙКИ" — все здания по категориям (строки-разделители), плашки бонусов, панель автостройки
// ============================================================
// Колонки: A категория* | B здание | C рем. | D мон. | E требует | F цепочка | G показатель* | H за 1 шт. | I баз. лимит* |
// J заполнено (полоска) | K построено | L лимит | M эффект | N авто | O приоритет | P свободно* | Q план хода   (* скрыты)
const BLD_HEAD = 11, BLD_FIRST = 12, BLD_BUDGET = "O4", BLD_MAXTURN = "O8";
const BLD_CATS = { "Сельское х-во": ["СЕЛЬСКОЕ ХОЗЯЙСТВО", "#6FA35A"], "Ремесло": ["РЕМЕСЛО", "#B8734A"], "Торговля": ["ТОРГОВЛЯ", "#C9A646"],
  "Религия": ["РЕЛИГИЯ", "#9277C9"], "Военные": ["ВОЕННОЕ ДЕЛО", "#C0503F"], "Инфраструктура": ["ИНФРАСТРУКТУРА", "#5B8DB8"], "Магия": ["МАГИЯ", "#4FA3A0"] };

// Раскладка строк: перед каждой категорией — строка-разделитель. Детерминирована по BUILDINGS.
function bldLayout() {
  const rows = [], bands = []; let r = BLD_FIRST, prev = null;
  BUILDINGS.forEach((b, i) => {
    if (b[0] !== prev) { bands.push({ row: r, cat: b[0], from: r + 1, to: r + 1, count: 0 }); r++; prev = b[0]; }
    rows.push(r); const band = bands[bands.length - 1]; band.to = r; band.count++; r++;
  });
  return { rows, bands, last: r - 1 };
}

function fillBuildingsSheet(ss) {
  const ws = ss.getSheetByName("Стройки"); ws.setHiddenGridlines(true);
  const L = bldLayout(), firstRow = BLD_FIRST, lastRow = L.last;
  DOCPROPS_().setProperties({ FIRST_B_ROW: String(firstRow), LAST_B_ROW: String(lastRow) });
  [20, 210, 70, 76, 150, 160, 20, 92, 20, 100, 56, 56, 92, 52, 58, 20, 76, 20, 20].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  paintParchment(ws, lastRow + 3, 19);
  sheetTitle(ws, 17, "Великая книга строек", `="ПОСТРОЕНО: "&COUNTIF(K${firstRow}:K${lastRow},">0")&" ИЗ ${BUILDINGS.length} ВИДОВ"`, 5);
  [[2, 10], [6, 8], [10, 12], [BLD_HEAD, 26]].forEach(([r, h]) => ws.setRowHeight(r, h));
  const rules = [];

  // Плашки итоговых бонусов (значения считаются на листе «Расчёты», строки 201-209)
  const tiles = [
    [3, 2, 1, "ЕДА", "=Расчёты!B201", "+#,##0;-#,##0;0", "в год"], [3, 3, 2, "РЕМЕСЛО", "=Расчёты!B202", "+#,##0;-#,##0;0", "в год"],
    [3, 5, 1, "ТОРГОВЛЯ", "=Расчёты!B203", "+#,##0;-#,##0;0", "монет в год"], [3, 6, 2, "КЛИРИКА", "=Расчёты!B204", "+0.0;-0.0;0", "за ход"],
    [3, 8, 3, "ЗАЩИТА", "=Расчёты!B209", "+0%;-0%;0%", "из 200%"],
    [7, 2, 1, "ЕДИНСТВО", "=Расчёты!B205*100", "+0.0;-0.0;0", "пунктов"], [7, 3, 2, "СОДЕРЖАНИЕ", "=Расчёты!B206", "0%", "скидка армии"],
    [7, 5, 1, "КРИЗИСЫ", "=Расчёты!B207", "0%", "ослабление"], [7, 6, 2, "ПРИЗЫВ", "=Расчёты!B208", "+0%;-0%;0%", "к призыву"],
    [7, 8, 3, "ИНФРАСТРУКТУРА", '="+"&ROUND(Расчёты!C201*100)&"% / +"&ROUND(Расчёты!C202*100)&"% / +"&ROUND(Расчёты!C203*100)&"%"', null, "еда / ремесло / торговля"]
  ];
  tiles.forEach(([r, c, nc, label, f, fmt, sub]) => {
    setPanel(ws, r, c, 3, nc);
    stCell(ws, r, c, nc, label, { font: FONT_TITLE, size: 8, bold: true, color: C.muted, valign: "bottom" });
    stCell(ws, r + 1, c, nc, f, { font: FONT_TITLE, size: 17, color: C.gold, fmt: fmt || undefined });
    stCell(ws, r + 2, c, nc, sub, { size: 10, color: C.muted, valign: "top" });
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setFontColor(C.muted).setRanges([ws.getRange(r + 1, c)]).build());
  });

  // Панель автостройки (светлые ячейки — ввод)
  setPanel(ws, 3, 11, 7, 7);
  stCell(ws, 3, 11, 7, "АВТОСТРОЙКА", { font: FONT_TITLE, size: 11, bold: true, color: C.gold });
  const auto = [[4, "Бюджет, % дохода", 30, '0"%"', true], [5, "Фонд сейчас", '=FIXED(Расчёты!B156,0)&" р · "&FIXED(Расчёты!B157,0)&" м"'],
    [6, "+ в этом ходу", '="+"&FIXED(Расчёты!B158,0)&" р · +"&FIXED(Расчёты!B159,0)&" м"', null, false, C.green],
    [7, "Доступно", '=FIXED(Расчёты!B160,0)&" р · "&FIXED(Расчёты!B161,0)&" м"', null, false, C.gold],
    [8, "Макс. построек за ход", 0, '0;0;"без лимита"', true]];
  auto.forEach(([r, label, v, fmt, input, color]) => {
    stCell(ws, r, 11, 4, label, { size: 11, fmt: "@" });
    stCell(ws, r, 15, 3, v, { size: 11, align: "center", fmt: fmt || undefined, color: color || (input ? C.gold : C.text), bold: input || color === C.gold, bg: input ? C.input : undefined });
  });
  stCell(ws, 9, 11, 7, "Светлые ячейки — ввод: бюджет, лимит, «Построено», «Авто», «Приоритет».", { size: 9, color: C.muted });

  // Шапка таблицы
  const heads = { 2: "ЗДАНИЕ", 3: "РЕМ.", 4: "МОН.", 5: "ТРЕБУЕТ", 6: "ЦЕПОЧКА", 8: "ЗА 1 ШТ.", 10: "ЗАПОЛНЕНО", 11: "ПОСТР.", 12: "ЛИМИТ", 13: "ЭФФЕКТ", 14: "АВТО", 15: "ПРИОР.", 17: "ПЛАН ХОДА" };
  Object.keys(heads).forEach(c => ws.getRange(BLD_HEAD, Number(c)).setValue(heads[c]));
  styleHeaderRow(ws, BLD_HEAD, 1, 17);
  ws.getRange(BLD_HEAD, 2).setHorizontalAlignment("left");

  // Строки-разделители категорий
  L.bands.forEach(bd => {
    const [title, color] = BLD_CATS[bd.cat] || [String(bd.cat).toUpperCase(), C.gold];
    const t = ws.getRange(bd.row, 2, 1, 5); t.merge();
    t.setFontFamily(FONT_TITLE).setFontSize(12).setFontWeight("bold").setFontColor(C.gold).setVerticalAlignment("bottom");
    ws.getRange(bd.row, 2).setRichTextValue(richRuns("■  " + title, [[0, 1, color]]));
    stCell(ws, bd.row, 8, 6, `="${bd.count} ${plural(bd.count, "здание", "здания", "зданий")} · построено "&COUNTIF(K${bd.from}:K${bd.to},">0")`, { size: 10, color: C.muted, valign: "bottom" });
    ws.getRange(bd.row, 1, 1, 17).setBorder(null, null, true, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID);
    ws.setRowHeight(bd.row, 30);
  });

  // Здания
  BUILDINGS.forEach((b, i) => {
    const r = L.rows[i];
    const [cat, name, rem, mon, res, chain, ind, prof, lim] = b;
    const scale = lim >= 3;
    const kind = String(prof).startsWith("=") ? "abs" : (ind === "клирика" ? "cler" : "pct");
    ws.getRange(r, 1, 1, 7).setValues([[cat, name, rem, mon, res, chain, ind]]);
    if (kind === "abs") ws.getRange(r, 8).setFormula(F(String(prof).replace(/([CD])\d+/g, "$1" + r)));   // прибыль от цены этой же строки
    else ws.getRange(r, 8).setValue(Number(prof));
    ws.getRange(r, 9).setValue(lim);
    ws.getRange(r, 10).setFormula(F(`=REPT("█",ROUND(10*MIN(1,K${r}/MAX(1,L${r}))))&REPT("░",10-ROUND(10*MIN(1,K${r}/MAX(1,L${r}))))`));
    ws.getRange(r, 11).setValue(0);
    if (scale) ws.getRange(r, 12).setFormula(F(`=MAX(${lim},FLOOR(${lim}*'Расчёты'!$B$13/50000,1))`)); else ws.getRange(r, 12).setValue(lim);
    let fEff;
    if (["Сельское х-во", "Ремесло", "Торговля"].includes(cat)) fEff = `=K${r}*H${r}`;
    else if (["Религия", "Магия"].includes(cat)) fEff = `=K${r}*H${r}/I${r}`;
    else fEff = `=IF(L${r}>0,H${r}*MIN(K${r},L${r})/L${r},0)`;
    ws.getRange(r, 13).setFormula(F(fEff));
    ws.getRange(r, 14).setValue(0); ws.getRange(r, 15).setValue(100);
    ws.getRange(r, 16).setFormula(F(`=MAX(0,L${r}-K${r})`));
    ws.getRange(r, 17).setValue(0);
    const fH = kind === "abs" ? "#,##0" : kind === "cler" ? '+0.0" кл."' : "+0%";
    const fM = kind === "abs" ? "+#,##0;-#,##0;0" : kind === "cler" ? "+0.0;-0.0;0" : "+0%;-0%;0%";
    ws.getRange(r, 8).setNumberFormat(fH); ws.getRange(r, 13).setNumberFormat(fM);
  });
  // Оформление тела таблицы (по колонкам, одним вызовом на колонку)
  const n = lastRow - firstRow + 1, col = (c) => ws.getRange(firstRow, c, n, 1);
  ws.getRange(firstRow, 1, n, 17).setFontFamily(FONT_BODY).setFontSize(11).setVerticalAlignment("middle").setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  col(2).setFontWeight("bold");
  col(3).setNumberFormat("#,##0").setHorizontalAlignment("right"); col(4).setNumberFormat("#,##0").setHorizontalAlignment("right");
  col(5).setFontSize(10).setWrap(true); col(6).setFontSize(10).setWrap(true);
  col(8).setHorizontalAlignment("right").setFontColor(C.muted);
  col(10).setFontFamily(FONT_BAR).setFontSize(8).setFontColor(C.gold);
  col(11).setHorizontalAlignment("center").setFontWeight("bold").setBackground(C.input).setFontColor(C.gold);
  col(12).setHorizontalAlignment("center").setFontColor(C.muted).setNumberFormat('"/ "0');
  col(13).setHorizontalAlignment("right").setFontColor(C.gold);
  col(14).setHorizontalAlignment("center").setBackground(C.input);
  col(15).setHorizontalAlignment("center").setBackground(C.input);
  col(17).setHorizontalAlignment("center").setFontWeight("bold").setFontColor(C.green).setNumberFormat('"+"0;"−"0;""');
  L.bands.forEach(bd => ws.getRange(bd.row, 11, 1, 5).setBackground(C.parchment));      // в строках-разделителях полей ввода нет
  const dvNum = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).build();
  const dvPrio = SpreadsheetApp.newDataValidation().requireNumberBetween(1, 500).build();
  const dvAuto = SpreadsheetApp.newDataValidation().requireCheckbox("1", "0").build();
  // проверки только на строках зданий (непрерывные блоки внутри категорий)
  L.bands.forEach(bd => {
    const len = bd.to - bd.from + 1;
    ws.getRange(bd.from, 11, len, 1).setDataValidation(dvNum);
    ws.getRange(bd.from, 14, len, 1).setDataValidation(dvAuto);
    ws.getRange(bd.from, 15, len, 1).setDataValidation(dvPrio);
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setFontColor(C.muted).setRanges([col(11), col(13)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ждёт").setFontColor(C.red).setRanges([col(17)]).build());
  ws.setConditionalFormatRules(rules);
  [1, 7, 9, 16, 18, 19].forEach(c => ws.hideColumns(c));
  ws.setFrozenRows(BLD_HEAD);
}

// Подсветка условий постройки: зелёным — выполнено, красным — не хватает ресурса или здания цепочки.
function refreshBuildingsView() {
  const ws = SS_().getSheetByName("Стройки"); if (!ws) return;
  const L = bldLayout(), n = L.last - BLD_FIRST + 1;
  const data = ws.getRange(BLD_FIRST, 1, n, 11).getValues();
  const isB = {}; L.rows.forEach(r => isB[r] = true);
  const built = {}; data.forEach((r, i) => { if (isB[BLD_FIRST + i]) built[String(r[1])] = Number(r[10]) || 0; });
  const res = getResourceCounts();
  const ce = [], cf = [];
  data.forEach((r, i) => {
    if (!isB[BLD_FIRST + i]) { ce.push([C.gold]); cf.push([C.gold]); return; }
    const req = parseRequirements(r[4]);
    ce.push([!String(r[4]).trim() ? C.rule : req.every(q => q.row && (res[q.row] || 0) >= q.need) ? C.green : C.red]);
    const ch = String(r[5] || "").trim();
    cf.push([!ch ? C.rule : (built[ch] > 0 ? C.green : C.red)]);
  });
  ws.getRange(BLD_FIRST, 5, n, 1).setFontColors(ce);
  ws.getRange(BLD_FIRST, 6, n, 1).setFontColors(cf);
}

// ============================================================
// ЛИСТ "РАСЧЁТЫ" (Без казны/склада, потребление 1+2, прямые ссылки)
// ============================================================
function fillCalcSheet(ss) {
  const ws = ss.getSheetByName("Расчёты"); ws.setHiddenGridlines(true); styleBanner(ws, 1, 1, 4, "С В И Т О К   Р А С Ч Ё Т О В"); styleOrnament(ws, 2, 1, 4);
  ws.getRange(3,1).setValue("Ресурс"); ws.getRange(3,2).setValue("Кол-во"); styleHeaderRow(ws, 3, 1, 2);
  const res = [[4,"Золото","=Ресурсы!B4"],[5,"Железо","=Ресурсы!B5"],[6,"Камни","=Ресурсы!B6"],[7,"Уголь","=Ресурсы!B7"],[8,"Соль","=Ресурсы!B8"],[9,"Благовония","=Ресурсы!B9"],[10,"Шёлк","=Ресурсы!B10"]];
  res.forEach(([r,n,f]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setFormula(f); ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });
  
  ws.getRange(12,1).setValue("Категория"); ws.getRange(12,2).setValue("Число"); styleHeaderRow(ws, 12, 1, 2);
  const pop = [[13,"Всего","=SUM(B14:B18)"],[14,"Крестьяне","=SUM('Регионы'!D4:D21)"],[15,"Ремесленники","=SUM('Регионы'!E4:E21)"],[16,"Торговцы","=SUM('Регионы'!F4:F21)"],[17,"Священники","=SUM('Регионы'!G4:G21)"],[18,"Феодалы","=SUM('Регионы'!H4:H21)"]];
  pop.forEach(([r,n,v]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setFormula(v); ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(20,1).setValue("Показатель"); ws.getRange(20,2).setValue("Значение"); styleHeaderRow(ws, 20, 1, 2); 
  ws.getRange(21,1).setValue("Производство"); ws.getRange(21,2).setFormula(F("=(SUM('Регионы'!O4:O21)+B201*B79)*(1+B126)")); 
  ws.getRange(22,1).setValue("Потребление"); ws.getRange(22,2).setFormula(F("=B13*1+B18*2")); 
  ws.getRange(23,1).setValue("Запас"); ws.getRange(23,2).setFormula(F("=B21-B22")); 
  [21,22,23].forEach(r => { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(25,1).setValue("Показатель"); ws.getRange(25,2).setValue("Значение"); styleHeaderRow(ws, 25, 1, 2); 
  ws.getRange(26,1).setValue("Ремесло в год"); ws.getRange(26,2).setFormula(F("=(SUM('Регионы'!P4:P21)+B202*B80)*(1+B127)")); 
  ws.getRange(26,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID);

  ws.getRange(28,1).setValue("Показатель"); ws.getRange(28,2).setValue("Значение"); styleHeaderRow(ws, 28, 1, 2); 
  ws.getRange(29,1).setValue("Доход торговли"); ws.getRange(29,2).setFormula(F("=SUM('Регионы'!Q4:Q21)+B203*B81")); 
  ws.getRange(30,1).setValue("Доход от золота"); ws.getRange(30,2).setFormula(F("=B4*200")); 
  ws.getRange(31,1).setValue("Итого доход"); ws.getRange(31,2).setFormula(F("=MAX(0,(B29+B30)*(1+B128))")); 
  ws.getRange(32,1).setValue("Расход на армию"); ws.getRange(32,2).setFormula(F("=B116")); 
  ws.getRange(33,1).setValue("Итог за год"); ws.getRange(33,2).setFormula(F("=B31-B32")); 
  [29,30,31,32,33].forEach(r => { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(35,1).setValue("Показатель"); ws.getRange(35,2).setValue("Значение"); styleHeaderRow(ws, 35, 1, 2); 
  ws.getRange(36,1).setValue("База"); ws.getRange(36,2).setValue(50); 
  ws.getRange(37,1).setValue("От священников"); ws.getRange(37,2).setFormula(F("=B17/100*0.1*(1+B55)")); 
  ws.getRange(38,1).setValue("От камней, благовоний, строек"); ws.getRange(38,2).setFormula(F("=B6*0.1+B9*0.1+B205*100")); 
  ws.getRange(39,1).setValue("Итого"); ws.getRange(39,2).setFormula(F("=MAX(0,MIN(100,B36+B37+B38-B78+B132+B133))")); 
  [36,37,38,39].forEach(r => { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(41,1).setValue("Показатель"); ws.getRange(41,2).setValue("Значение"); styleHeaderRow(ws, 41, 1, 2); 
  ws.getRange(42,1).setValue("Специалисты"); ws.getRange(42,2).setFormula(F("=MAX(0,B18/10*5*(1-B77)*(1+B208)*(1+B130))")); 
  ws.getRange(43,1).setValue("Сброд"); ws.getRange(43,2).setFormula(F("=MAX(0,B18/10*20*(1-B77)*(1+B130))")); 
  ws.getRange(44,1).setValue("Всего"); ws.getRange(44,2).setFormula(F("=B42+B43")); 
  [42,43,44].forEach(r => { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(50,1).setValue("Модификатор"); ws.getRange(50,2).setValue("Значение"); styleHeaderRow(ws, 50, 1, 2);
  const mods = [[51,"Уголь -> ремесло","=MIN(0.3,B7*0.15)"],[52,"Соль -> производство еды","=MIN(0.2,B8*0.1)"],[53,"Соль -> сохранность","=MIN(0.2,B8*0.1)"],[54,"Шёлк -> торговля","=MIN(0.3,B10*0.15)"],[55,"Благовония -> священники","=MIN(0.3,B9*0.1)"],[56,"Железо -> содержание","=MIN(0.2,B5*0.05)"]];
  mods.forEach(([r,n,f]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setFormula(F(f)); ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  ws.getRange(58,1).setValue("Сословие"); ws.getRange(58,2).setValue("Лояльность, %"); styleHeaderRow(ws, 58, 1, 2);
  const loyal = [[59,"Крестьяне","='Регионы'!I23"],[60,"Ремесленники","='Регионы'!J23"],[61,"Торговцы","='Регионы'!K23"],[62,"Священники","='Регионы'!L23"],[63,"Феодалы",F("=MIN(100,'Регионы'!M23+B6*5)")]];
  loyal.forEach(([r,n,v]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setFormula(v).setNumberFormat('0"%"'); ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  styleBanner(ws, 65, 1, 3, "К Р И З И С Ы"); ws.getRange(66,1).setValue("Название"); ws.getRange(66,2).setValue("Активен"); ws.getRange(66,3).setValue("Эффект"); styleHeaderRow(ws, 66, 1, 3);
  const crises = [[67,"Голод",F('=IF(B23<B22*0.05,"ДА","НЕТ")'),"Население -5%, ремесло -10%",false],[68,"Бунт феодалов",F('=IF(B63<20,"ДА","НЕТ")'),"Призыв -50%, единство -5%",false],[69,"Религиозный раскол",F('=IF(B62<20,"ДА","НЕТ")'),"Ремесло -10%, торговля -10%",false],[70,"Поветрие","НЕТ","Население -5%, ремесло -10%",true],[71,"Набеги","НЕТ","Еда -10%, казна -10%, призыв -5%",true],[72,"Опустошение земель","НЕТ","Еда -15%, ремесло -15%",true],[73,"Нападение диких зверей","НЕТ","Еда -5%, население -2%",true]];
  const dvCrisis = SpreadsheetApp.newDataValidation().requireValueInList(["ДА","НЕТ"], true).build();
  crises.forEach(([r,n,a,e,manual]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); if (typeof a === "string" && a.startsWith("= ")) ws.getRange(r,2).setFormula(a); else ws.getRange(r,2).setValue(a).setHorizontalAlignment("center"); ws.getRange(r,3).setValue(e); if (manual) ws.getRange(r,2).setDataValidation(dvCrisis); ws.getRange(r,1,1,3).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  styleBanner(ws, 75, 1, 3, "Ч И С Л О В Ы Е   М О Д И Ф И К А Т О Р Ы"); ws.getRange(76,1).setValue("Модификатор"); ws.getRange(76,2).setValue("Значение"); styleHeaderRow(ws, 76, 1, 2);
  const cm = [[77,"Потеря призыва",F('=(IF(B68="ДА",0.5,0)+IF(B71="ДА",0.05,0))*(1-B207)')],[78,"Штраф единства",F('=IF(B68="ДА",5,0)*(1-B207)')],[79,"Множ. еды",F('=(IF(B71="ДА",0.9,1)*IF(B72="ДА",0.85,1)*IF(B73="ДА",0.95,1))*(1-B207)+B207')],[80,"Множ. ремесла",F('=(IF(B67="ДА",0.9,1)*IF(B69="ДА",0.9,1)*IF(B70="ДА",0.9,1)*IF(B72="ДА",0.85,1))*(1-B207)+B207')],[81,"Множ. торговли",F('=(IF(B69="ДА",0.9,1)*IF(B71="ДА",0.9,1))*(1-B207)+B207')]];
  cm.forEach(([r,n,f]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setFormula(f).setNumberFormat("0.000"); ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  styleBanner(ws, 83, 1, 4, "И З М Е Н Е Н И Е   Л О Я Л Ь Н О С Т И"); ws.getRange(84,1).setValue("Сословие"); ws.getRange(84,2).setValue("Ручное"); ws.getRange(84,3).setValue("Авто"); ws.getRange(84,4).setValue("Итог"); styleHeaderRow(ws, 84, 1, 4);
  const lc = [[85,"Крестьяне",F('=IF(B67="ДА",-3,0)+IF(B70="ДА",-2,0)+IF(B71="ДА",-2,0)+IF(B72="ДА",-5,0)+IF(B73="ДА",-2,0)')],[86,"Ремесленники",F('=IF(B67="ДА",-3,0)+IF(B70="ДА",-2,0)+IF(B71="ДА",-2,0)+IF(B72="ДА",-5,0)')],[87,"Торговцы",F('=IF(B67="ДА",-3,0)+IF(B70="ДА",-2,0)+IF(B71="ДА",-2,0)')],[88,"Священники",F('=IF(B67="ДА",-3,0)+IF(B69="ДА",-5,0)+IF(B70="ДА",-2,0)+IF(B71="ДА",-2,0)')],[89,"Феодалы",F('=IF(B67="ДА",-3,0)+IF(B68="ДА",-5,0)+IF(B70="ДА",-2,0)+IF(B71="ДА",-2,0)')]];
  lc.forEach(([r,n,af]) => { ws.getRange(r,1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r,2).setValue(0).setNumberFormat('+0"%";-0"%";0"%"'); ws.getRange(r,3).setFormula(af + "+B" + (r + 52)).setNumberFormat('+0"%";-0"%";0"%"').setHorizontalAlignment("center"); ws.getRange(r,4).setFormula(F(`=B${r}+C${r}`)).setNumberFormat('+0"%";-0"%";0"%"').setHorizontalAlignment("center").setFontWeight("bold"); ws.getRange(r,1,1,4).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  styleBanner(ws, 91, 1, 3, "П Р И Р О С Т   Н А С Е Л Е Н И Я"); ws.getRange(92,1).setValue("Показатель"); ws.getRange(92,2).setValue("Значение"); styleHeaderRow(ws, 92, 1, 2); ws.getRange(93,1).setValue("База"); ws.getRange(93,2).setFormula(F("=IF(B23>0,0.01,0)")); ws.getRange(94,1).setValue("Штраф кризисов"); ws.getRange(94,2).setFormula(F('=IF(B67="ДА",0.05,0)+IF(B70="ДА",0.05,0)+IF(B73="ДА",0.02,0)')); ws.getRange(95,1).setValue("Итог"); ws.getRange(95,2).setFormula(F("=B93-B94+B131")).setNumberFormat('+0.0%;-0.0%;0.0%'); ws.getRange(96,1).setValue("Чел./год"); ws.getRange(96,2).setFormula(F("=ROUND(B13*B95,0)")); [93,94,95,96].forEach(r => { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  styleBanner(ws, 98, 1, 3, "К Л И Р И К А"); ws.getRange(99,1).setValue("Показатель"); ws.getRange(99,2).setValue("Значение"); styleHeaderRow(ws, 99, 1, 2); ws.getRange(100,1).setValue("От священников"); ws.getRange(100,2).setFormula(F("=B17/100")); ws.getRange(101,1).setValue("От благовоний"); ws.getRange(101,2).setFormula(F("=IF(B9>=1,1,0)+IF(B9>=2,0.75,0)+IF(B9>=3,0.5,0)+IF(B9>=4,0.25,0)")); ws.getRange(102,1).setValue("От храмов и строек"); ws.getRange(102,2).setFormula(F("=B204")); ws.getRange(103,1).setValue("Итого прирост"); ws.getRange(103,2).setFormula(F("=B100+B101+B102+B134")); ws.getRange(104,1).setValue("Потрачено"); ws.getRange(104,2).setValue(0); ws.getRange(105,1).setValue("Клирика начало"); ws.getRange(105,2).setValue(0); ws.getRange(106,1).setValue("Клирика конец"); ws.getRange(106,2).setFormula(F("=B105+B103-B104")); ws.getRange(107,1).setValue("Угроза"); ws.getRange(107,2).setFormula(F('=IF(B106<=-20,"ВТОРЖЕНИЕ",IF(B106<=-10,"РАЗРЫВ",IF(B106<=-5,"ПРЕДУПРЕЖДЕНИЕ","СТАБИЛЬНО")))')); for (let r = 100; r <= 107; r++) { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); }

  styleBanner(ws, 110, 1, 3, "С О Д Е Р Ж А Н И Е   А Р М И И"); ws.getRange(111,1).setValue("Показатель"); ws.getRange(111,2).setValue("Значение"); styleHeaderRow(ws, 111, 1, 2); ws.getRange(112,1).setValue("Число бойцов"); ws.getRange(112,2).setFormula(F("=SUM('Армия'!G15:G64)")); ws.getRange(113,1).setValue("База"); ws.getRange(113,2).setFormula(F("=SUM('Армия'!R15:R64)")); ws.getRange(114,1).setValue("Скидка железа"); ws.getRange(114,2).setFormula(F("=MIN(0.2,B5*0.05)")); ws.getRange(115,1).setValue("Скидка строек"); ws.getRange(115,2).setFormula(F("=B206")); ws.getRange(116,1).setValue("Итог"); ws.getRange(116,2).setFormula(F("=MAX(0,B113*(1-B114)*(1-B115)*(1+B129))")); for (let r = 112; r <= 116; r++) { ws.getRange(r,1,1,2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); }

  // Бонусы от строек считаются прямо по таблице «Стройки». B: еда/ремесло/торговля — абсолютная прибыль построек своей
  // категории; C201:C203 — процентный бонус от построек других категорий с тем же показателем (Мосты, Дороги, Библиотека…).
  const BL = bldLayout(), SR = (c) => `'Стройки'!$${c}$${BLD_FIRST}:$${c}$${BL.last}`;
  const absF = (ind, cat) => `=SUMIFS(${SR("M")},${SR("G")},"${ind}",${SR("A")},"${cat}")`;
  const pctF = (ind, cat) => `=SUMIFS(${SR("M")},${SR("G")},"${ind}",${SR("A")},"<>${cat}")`;
  const capF = (ind, cap) => `=MIN(${cap},SUMIF(${SR("G")},"${ind}",${SR("M")}))`;
  const BONUS_F = [absF("еда", "Сельское х-во"), absF("ремесло", "Ремесло"), absF("торговля", "Торговля"), `=SUMIF(${SR("G")},"клирика",${SR("M")})`,
    capF("единство", 0.5), capF("содержание", 0.5), capF("кризисы", 0.9), capF("призыв", 1), capF("защита", 2)];
  const BONUS_PCT = [pctF("еда", "Сельское х-во"), pctF("ремесло", "Ремесло"), pctF("торговля", "Торговля")];
  // Остальные формулы листа ссылаются именно на эти строки: B201 еда, B202 ремесло, B203 торговля, B204 клирика,
  // B205 единство, B206 содержание, B207 кризисы, B208 призыв, B209 защита.
  styleBanner(ws, 200, 1, 3, "Б О Н У С Ы   О Т   С Т Р О Е К");
  ["Бонус к еде (ед./год)","Бонус к ремеслу (ед./год)","Бонус к торговле (мон./год)","Бонус Клирики","Бонус к единству","Скидка содержания","Снижение кризисов","Бонус к призыву","Бонус к защите"].forEach((label, i) => {
    const r = 201 + i;
    ws.getRange(r, 1).setValue(label).setFontFamily(FONT_BODY);
    ws.getRange(r, 2).setFormula(F(BONUS_F[i])).setFontWeight("bold");
    if (i < 3) ws.getRange(r, 3).setFormula(F(BONUS_PCT[i])).setNumberFormat('+0.0%;-0.0%;0.0%');
    ws.getRange(r, 1, 1, 3).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID);
  });

  // Суммы эффектов АКТИВНЫХ модификаторов (лист «Модификаторы», строки 5-104). Проценты на листе — числом (−25 = −25%).
  styleBanner(ws, 125, 1, 3, "М О Д И Ф И К А Т О Р Ы");
  const MR = (col) => `'Модификаторы'!$${col}$${MOD_FIRST}:$${col}$${MOD_LAST}`;
  const act = (k) => `SUMIF(${MR("C")},"АКТИВЕН",${MR(modL(k))})`;
  [[126, "Еда, %", `=${act(6)}/100`], [127, "Ремесло, %", `=${act(7)}/100`], [128, "Доход, %", `=${act(8)}/100`],
   [129, "Содержание армии, %", `=${act(9)}/100`], [130, "Призыв, %", `=${act(10)}/100`], [131, "Прирост населения", `=${act(11)}/100`],
   [132, "Единство (пока активны)", `=${act(12)}`], [134, "Клирика в ход", `=${act(19)}`], [135, "Казна в ход", `=${act(20)}`], [136, "Склад в ход", `=${act(21)}`],
   [137, "Лояльность крестьян в ход", `=${act(14)}`], [138, "Лояльность ремесленников в ход", `=${act(15)}`], [139, "Лояльность торговцев в ход", `=${act(16)}`],
   [140, "Лояльность священников в ход", `=${act(17)}`], [141, "Лояльность феодалов в ход", `=${act(18)}`]
  ].forEach(([r, n, f]) => { ws.getRange(r, 1).setValue(n).setFontFamily(FONT_BODY); ws.getRange(r, 2).setFormula(F(f)).setFontWeight("bold"); ws.getRange(r, 1, 1, 2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });
  ws.getRange(133, 1).setValue("Единство накопленное (от «в ход»)").setFontFamily(FONT_BODY); ws.getRange(133, 2).setValue(0).setFontWeight("bold");
  ws.getRange(133, 1, 1, 2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID);

  // Казна и склад: расходы по вердикту (пишет Мастер хода), текущие остатки и изменение за ход
  styleBanner(ws, 142, 1, 3, "К А З Н А   И   С К Л А Д");
  [[143, "Расход склада по вердикту (Мастер хода)", 0], [144, "Расход казны по вердикту (Мастер хода)", 0],
   [150, "Казна сейчас", "=INDEX('Журнал'!R:R,MATCH(9^9,'Журнал'!B:B))"], [151, "Склад сейчас", "=INDEX('Журнал'!O:O,MATCH(9^9,'Журнал'!B:B))"],
   [152, "Казна: изменение за ход", "=B31*(1-B155/100)-B32-B144+B135"], [153, "Склад: изменение за ход", "=B26*(1-B155/100)-B143+B136"],
   [154, "Последний применённый ход", "=INDEX('Журнал'!A:A,MATCH(9^9,'Журнал'!B:B))"],
   [155, "Бюджет стройки, % дохода", "='Стройки'!O4"], [156, "Фонд стройки сейчас: ремесло", "=INDEX('Журнал'!I:I,MATCH(9^9,'Журнал'!B:B))"],
   [157, "Фонд стройки сейчас: монеты", "=INDEX('Журнал'!J:J,MATCH(9^9,'Журнал'!B:B))"], [158, "Ремесло в фонд за ход", "=B26*B155/100"],
   [159, "Монеты в фонд за ход", "=B31*B155/100"], [160, "Доступно ремесла", "=B156+B158"], [161, "Доступно монет", "=B157+B159"]
  ].forEach(([r, n, v]) => { ws.getRange(r, 1).setValue(n).setFontFamily(FONT_BODY); if (typeof v === "string") ws.getRange(r, 2).setFormula(F(v)); else ws.getRange(r, 2).setValue(v); ws.getRange(r, 1, 1, 2).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); });

  [300, 140, 200, 100].forEach((w, i) => ws.setColumnWidth(i + 1, w)); paintParchment(ws, 215, 6, C.parchmentDark);
  // Ручные поля (кризисы 70-73, поправки лояльности, расходы хода) — подсветка как ввод
  ["B70:B73", "B85:B89", "B104", "B143:B144"].forEach(a => ws.getRange(a).setBackground(C.input));
}

// ============================================================
// ЛИСТ "АРМИЯ" — отряды (знамёна), мощь, содержание, справочник
// ============================================================
const ARMY_FIRST = 15, ARMY_LAST = 64, ARMY_REF_ROW = 69;
const ARMY_TYPES = [["Пехота", "ПХ", 1, 1], ["Стрелки", "СТР", 1, 1], ["Конница", "КОН", 2, 1], ["Осадные", "ОСД", 3, 1], ["Магия", "МАГ", 2, 1], ["Особое", "ОСБ", 1.5, 1]];
const ARMY_COLORS = ["#C9A646", "#6FA35A", "#5B8DB8", "#B8734A", "#9277C9", "#A8956A"];
const ARMOR_LIST = [["Без брони", 1], ["Стёганка", 1.15], ["Варёная кожа", 1.3], ["Чешуя", 1.45], ["Кольчуга", 1.6], ["Бригантина", 1.75], ["Полулаты", 1.9], ["Полные латы", 2.05]];
const TRAIN_LIST = [["Новобранцы", 1], ["Обученные", 1.25], ["Ветераны", 1.5], ["Элита", 2]];
const WEAPON_LIST = ["Древковое", "Одноручное", "Двуручное", "Ударно-дробящее", "Лёгкое дистанц.", "Тяжёлое дистанц.", "Огнестрельное"];
const UNIT_STATES = ["В гарнизоне", "В походе", "Идёт сбор", "В обозе", "Разбит"];
const ARMY_WIDTHS = [18, 50, 190, 95, 95, 105, 60, 60, 95, 110, 80, 125, 100, 60, 55, 90, 70, 75, 18];

function fillArmySheet(ss) {
  const ws = ss.getSheetByName("Армия") || ss.insertSheet("Армия"); ws.setHiddenGridlines(true);
  ARMY_WIDTHS.forEach((w, i) => ws.setColumnWidth(i + 1, w));
  paintParchment(ws, ARMY_REF_ROW + 12, 19);
  [[1, 14], [2, 18], [3, 44], [4, 14], [5, 22], [6, 40], [7, 22], [8, 14], [9, 26], [10, 22], [11, 22], [12, 14], [13, 26], [14, 24]].forEach(([r, h]) => ws.setRowHeight(r, h));
  const n = ARMY_LAST - ARMY_FIRST + 1, RNG = (col) => `${col}${ARMY_FIRST}:${col}${ARMY_LAST}`;
  const rules = [];

  stCell(ws, 2, 2, 11, "В О Й С К О", { font: FONT_TITLE, size: 9, color: C.muted, valign: "bottom" });
  stCell(ws, 3, 2, 11, "=Статистика!B3", { font: FONT_TITLE, size: 24, bold: true, color: C.gold, valign: "bottom" });
  stCell(ws, 2, 17, 2, "ХОД", { font: FONT_TITLE, size: 9, color: C.muted, align: "right", valign: "bottom" });
  stCell(ws, 3, 17, 2, "=Расчёты!B154", { font: FONT_TITLE, size: 20, color: C.gold, align: "right", valign: "bottom", fmt: "0" });
  ws.getRange(3, 2, 1, 17).setBorder(null, null, true, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID);

  const tiles = [
    [2, 2, "В СТРОЮ", "=Расчёты!B112", "#,##0", `="отрядов: "&COUNTA(${RNG("C")})`],
    [4, 3, "МОЩЬ АРМИИ ⓘ", `=SUM(${RNG("Q")})`, "#,##0", '="сумма мощи отрядов"'],
    [7, 4, "СОДЕРЖАНИЕ ⓘ", "=Расчёты!B116", '#,##0" мон."', '=IF(Расчёты!B116>Расчёты!B31,"▼ больше дохода на "&FIXED(Расчёты!B116-Расчёты!B31,0),"доход покрывает: "&FIXED(Расчёты!B31,0))'],
    [11, 3, "РЕЗЕРВ ПРИЗЫВА ⓘ", "=MAX(0,Расчёты!B44-Расчёты!B112)", "#,##0", '="из "&FIXED(Расчёты!B44,0)'],
    [14, 5, "СРЕДНИЙ ДУХ", `=IFERROR(SUMPRODUCT(${RNG("G")},${RNG("O")})/SUM(${RNG("G")}),0)`, '0"%"', '=REPT("█",ROUND(N6/10))&REPT("░",10-ROUND(N6/10))']
  ];
  tiles.forEach(([c, nc, label, value, fmt, sub]) => {
    setPanel(ws, 5, c, 3, nc);
    infoLabel(ws, 5, c, nc, label);
    stCell(ws, 6, c, nc, value, { font: FONT_TITLE, size: 20, color: C.gold, fmt: fmt });
    stCell(ws, 7, c, nc, sub, { font: c === 14 ? FONT_BAR : FONT_BODY, size: c === 14 ? 9 : 10, color: c === 14 ? C.gold : C.muted, valign: "top" });
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("▼").setFontColor(C.red).setRanges([ws.getRange("B7:R7")]).build());

  // Состав: цветная полоса и легенда (рисуются кодом — refreshArmyView)
  setPanel(ws, 9, 2, 3, 17);
  stCell(ws, 9, 2, 17, "СОСТАВ", { font: FONT_TITLE, size: 11, bold: true, color: C.gold });
  stCell(ws, 10, 2, 17, "", { font: FONT_BAR, size: 11 });
  stCell(ws, 11, 2, 17, "", { size: 11 });

  // Знамёна
  setPanel(ws, 13, 2, n + 3, 17);
  stCell(ws, 13, 2, 17, "ЗНАМЁНА", { font: FONT_TITLE, size: 11, bold: true, color: C.gold });
  const heads = ["", "ОТРЯД", "РОД ВОЙСК", "РЕГИОН", "СОСТОЯНИЕ", "ЧИСЛ.", "ШТАТ", "", "БРОНЯ", "", "ОРУЖИЕ", "ОБУЧЕНИЕ", "", "ДУХ", "", "МОЩЬ ⓘ", "МОН./ХОД ⓘ"];
  heads.forEach((h, i) => { if (h.indexOf("ⓘ") >= 0) infoLabel(ws, 14, 2 + i, 1, h); else stCell(ws, 14, 2 + i, 1, h, { font: FONT_TITLE, size: 8, bold: true, color: C.muted, valign: "bottom" }); });
  ws.getRange(14, 2, 1, 17).setBorder(null, null, true, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID);
  ws.getRange(14, 17, 1, 2).setHorizontalAlignment("right");
  ws.getRange(14, 17).setNote("Мощь = численность × броня × обучение × дух × род войск. Наведите на мощь отряда — увидите расчёт.");
  ws.getRange(14, 18).setNote("Монет за ход: бойцы × «мон. за бойца» рода войск (справочник ниже). Скидки железа и Арсенала — в плашке «Содержание».");

  const col = (f) => { const a = []; for (let r = ARMY_FIRST; r <= ARMY_LAST; r++) a.push([F(f(r))]); return a; };
  const T = `$C$${ARMY_REF_ROW + 1}:$F$${ARMY_REF_ROW + 6}`, AR = `$J$${ARMY_REF_ROW + 1}:$K$${ARMY_REF_ROW + 8}`, TR = `$L$${ARMY_REF_ROW + 1}:$M$${ARMY_REF_ROW + 4}`;
  const AN = `$J$${ARMY_REF_ROW + 1}:$J$${ARMY_REF_ROW + 8}`, TN = `$L$${ARMY_REF_ROW + 1}:$L$${ARMY_REF_ROW + 4}`;
  const ratio = (r) => `MIN(1,G${r}/MAX(1,IF(H${r}="",G${r},H${r})))`;
  ws.getRange(ARMY_FIRST, 2, n, 1).setFormulas(col(r => `=IF(D${r}="","",IFERROR(VLOOKUP(D${r},${T},2,FALSE),"?"))`));
  ws.getRange(ARMY_FIRST, 9, n, 1).setFormulas(col(r => `=IF(G${r}="","",REPT("█",ROUND(10*${ratio(r)}))&REPT("░",10-ROUND(10*${ratio(r)})))`));
  ws.getRange(ARMY_FIRST, 11, n, 1).setFormulas(col(r => `=IF(J${r}="","",IFERROR(REPT("●",MATCH(J${r},${AN},0))&REPT("○",8-MATCH(J${r},${AN},0)),""))`));
  ws.getRange(ARMY_FIRST, 14, n, 1).setFormulas(col(r => `=IF(M${r}="","",IFERROR(REPT("★",MATCH(M${r},${TN},0))&REPT("☆",4-MATCH(M${r},${TN},0)),""))`));
  ws.getRange(ARMY_FIRST, 16, n, 1).setFormulas(col(r => `=IF(O${r}="","",REPT("█",ROUND(O${r}/10))&REPT("░",10-ROUND(O${r}/10)))`));
  ws.getRange(ARMY_FIRST, 17, n, 1).setFormulas(col(r => `=IF(OR(G${r}="",D${r}=""),"",ROUND(G${r}*IFERROR(VLOOKUP(J${r},${AR},2,FALSE),1)*IFERROR(VLOOKUP(M${r},${TR},2,FALSE),1)*(0.5+IF(O${r}="",50,O${r})/200)*IFERROR(VLOOKUP(D${r},${T},3,FALSE),1)))`));
  ws.getRange(ARMY_FIRST, 18, n, 1).setFormulas(col(r => `=IF(G${r}="","",G${r}*IFERROR(VLOOKUP(D${r},${T},4,FALSE),1))`));

  const body = ws.getRange(ARMY_FIRST, 2, n, 17);
  body.setFontFamily(FONT_BODY).setFontSize(11).setFontColor(C.text).setVerticalAlignment("middle")
    .setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  ws.setRowHeights(ARMY_FIRST, n, 30);
  ws.getRange(ARMY_FIRST, 2, n, 1).setFontFamily(FONT_TITLE).setFontSize(8).setFontWeight("bold").setFontColor(C.dark).setHorizontalAlignment("center");
  ws.getRange(ARMY_FIRST, 3, n, 1).setFontWeight("bold");
  [3, 4, 5, 6, 7, 8, 10, 12, 13, 15].forEach(c => ws.getRange(ARMY_FIRST, c, n, 1).setBackground(C.input));
  [9, 11, 14, 16].forEach(c => ws.getRange(ARMY_FIRST, c, n, 1).setFontFamily(FONT_BAR).setFontSize(8).setFontColor(C.gold));
  [7, 8, 15].forEach(c => ws.getRange(ARMY_FIRST, c, n, 1).setHorizontalAlignment("center"));
  ws.getRange(ARMY_FIRST, 17, n, 1).setFontFamily(FONT_TITLE).setFontSize(12).setFontColor(C.gold).setHorizontalAlignment("right").setNumberFormat("#,##0");
  ws.getRange(ARMY_FIRST, 18, n, 1).setFontColor(C.muted).setHorizontalAlignment("right").setNumberFormat("#,##0");

  const refRange = (c, len) => ws.getRange(ARMY_REF_ROW + 1, c, len, 1);
  ws.getRange(ARMY_FIRST, 4, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(refRange(3, ARMY_TYPES.length), true).build());
  const regs = ss.getSheetByName("Регионы");
  if (regs) ws.getRange(ARMY_FIRST, 5, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(regs.getRange("A4:A21"), true).setAllowInvalid(true).build());
  ws.getRange(ARMY_FIRST, 6, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(UNIT_STATES, true).build());
  ws.getRange(ARMY_FIRST, 7, n, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).build());
  ws.getRange(ARMY_FIRST, 10, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(refRange(10, ARMOR_LIST.length), true).build());
  ws.getRange(ARMY_FIRST, 12, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(WEAPON_LIST, true).build());
  ws.getRange(ARMY_FIRST, 13, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(refRange(12, TRAIN_LIST.length), true).build());
  ws.getRange(ARMY_FIRST, 15, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 100).build());

  ARMY_TYPES.forEach(([, code], i) => rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(code).setBackground(ARMY_COLORS[i]).setFontColor(C.dark).setRanges([ws.getRange(RNG("B"))]).build()));
  const moraleCells = [ws.getRange(RNG("O")), ws.getRange(RNG("P"))];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=($O${ARMY_FIRST}<>"")*($O${ARMY_FIRST}<40)>0`).setFontColor(C.red).setRanges(moraleCells).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$O${ARMY_FIRST}>=70`).setFontColor(C.green).setRanges(moraleCells).build());

  const tot = ARMY_LAST + 1;
  stCell(ws, tot, 3, 1, "ИТОГО", { font: FONT_TITLE, size: 9, bold: true, color: C.gold });
  stCell(ws, tot, 7, 1, `=SUM(${RNG("G")})`, { bold: true, align: "center", fmt: "#,##0" });
  stCell(ws, tot, 8, 1, `=SUM(${RNG("H")})`, { color: C.muted, align: "center", fmt: "#,##0" });
  stCell(ws, tot, 17, 1, `=SUM(${RNG("Q")})`, { font: FONT_TITLE, size: 12, bold: true, color: C.gold, align: "right", fmt: "#,##0" });
  stCell(ws, tot, 18, 1, `=SUM(${RNG("R")})`, { bold: true, align: "right", fmt: "#,##0" });
  ws.getRange(tot, 2, 1, 17).setBorder(true, null, null, null, null, null, C.rule, SpreadsheetApp.BorderStyle.SOLID);

  // Справочник (меняется админом — формулы листа берут коэффициенты отсюда)
  stCell(ws, ARMY_REF_ROW - 2, 2, 17, "СПРАВОЧНИК МОЩИ И СОДЕРЖАНИЯ — значения можно менять", { font: FONT_TITLE, size: 11, bold: true, color: C.gold });
  const refHead = (c, titles) => titles.forEach((t, i) => stCell(ws, ARMY_REF_ROW, c + i, 1, t, { font: FONT_TITLE, size: 8, bold: true, color: C.muted, align: i ? "center" : "left" }));
  refHead(3, ["РОД ВОЙСК", "КОД", "МОЩЬ ×", "МОН. ЗА БОЙЦА"]); refHead(10, ["БРОНЯ", "МОЩЬ ×"]); refHead(12, ["ОБУЧЕНИЕ", "МОЩЬ ×"]);
  ws.getRange(ARMY_REF_ROW + 1, 3, ARMY_TYPES.length, 4).setValues(ARMY_TYPES);
  ws.getRange(ARMY_REF_ROW + 1, 10, ARMOR_LIST.length, 2).setValues(ARMOR_LIST);
  ws.getRange(ARMY_REF_ROW + 1, 12, TRAIN_LIST.length, 2).setValues(TRAIN_LIST);
  [[3, ARMY_TYPES.length, 4], [10, ARMOR_LIST.length, 2], [12, TRAIN_LIST.length, 2]].forEach(([c, len, w]) => {
    setPanel(ws, ARMY_REF_ROW, c, len + 1, w);
    ws.getRange(ARMY_REF_ROW + 1, c + 1, len, w - 1).setBackground(C.input).setHorizontalAlignment("center");
  });
  ws.getRange(ARMY_REF_ROW + 1, 4, ARMY_TYPES.length, 1).setBackground(C.panel).setFontFamily(FONT_TITLE).setFontSize(8).setFontWeight("bold");
  stCell(ws, ARMY_REF_ROW + 10, 3, 11, "Дух: мощь × (0,5 + дух/200) — от ×0,5 при 0% до ×1 при 100%; пустой дух считается как 50%. Оружие пока на мощь не влияет.", { size: 10, color: C.muted });
  ws.setConditionalFormatRules(rules);
}

// Состав войска (цветная полоса и легенда), расшифровка мощи отрядов и пояснения плашек.
function refreshArmyView() {
  const ss = SS_(); const ws = ss.getSheetByName("Армия"); if (!ws) return;
  const n = ARMY_LAST - ARMY_FIRST + 1;
  const rows = ws.getRange(ARMY_FIRST, 3, n, 14).getValues();                       // C..P
  const types = ws.getRange(ARMY_REF_ROW + 1, 3, ARMY_TYPES.length, 4).getValues(); // имя, код, мощь×, мон.
  const armor = ws.getRange(ARMY_REF_ROW + 1, 10, ARMOR_LIST.length, 2).getValues();
  const train = ws.getRange(ARMY_REF_ROW + 1, 12, TRAIN_LIST.length, 2).getValues();
  const look = (tbl, key, col, def) => { const t = tbl.find(x => x[0] === key); const v = t ? Number(t[col]) : NaN; return isNaN(v) ? def : v; };
  const totals = types.map(() => 0);
  const notes = rows.map(r => {
    const name = r[0], type = r[1], cnt = Number(r[4]) || 0;
    const ti = types.findIndex(t => t[0] === type); if (ti >= 0) totals[ti] += cnt;
    if (!type || !cnt) return [""];
    const am = look(armor, r[7], 1, 1), tm = look(train, r[10], 1, 1), morale = r[12] === "" ? 50 : Number(r[12]) || 0, mm = 0.5 + morale / 200, ym = look(types, type, 2, 1);
    return [`${name || "Отряд"}: мощь ${fmtN(cnt * am * tm * mm * ym)}\n= ${fmtN(cnt)} бойцов × броня ${fmtD(am, 2)} × обучение ${fmtD(tm, 2)} × дух ${fmtD(mm, 2)} × род войск ${fmtD(ym, 2)}`];
  });
  ws.getRange(ARMY_FIRST, 17, n, 1).setNotes(notes);

  const sum = totals.reduce((a, b) => a + b, 0), W = 120;
  if (sum > 0) {
    const lens = distributeByLargestRemainder(totals, sum, W);
    let text = "", runs = [];
    lens.forEach((len, i) => { if (len > 0) { runs.push([text.length, text.length + len, ARMY_COLORS[i]]); text += "█".repeat(len); } });
    ws.getRange(10, 2).setRichTextValue(richRuns(text, runs));
    let leg = "", lruns = [];
    totals.forEach((t, i) => { if (t > 0) { if (leg) leg += "      "; lruns.push([leg.length, leg.length + 1, ARMY_COLORS[i]]); leg += "■ " + types[i][0] + " " + fmtN(t); } });
    ws.getRange(11, 2).setRichTextValue(richRuns(leg, lruns));
  } else {
    ws.getRange(10, 2).setRichTextValue(richRuns("░".repeat(W), [[0, W, C.line]]));
    ws.getRange(11, 2).setValue("Отрядов нет — заполните строку в «Знамёнах»: название, род войск, численность.");
  }

  const calc = ss.getSheetByName("Расчёты"); if (!calc) return;
  const cv = calc.getRange(1, 2, 165, 1).getValues(); const g = r => Number(cv[r - 1][0]) || 0;
  ws.getRange(5, 4).setNote("Мощь армии = сумма мощи отрядов.\nМощь отряда = численность × броня × обучение × дух × род войск.\nДух: ×(0,5 + дух/200).\nКоэффициенты — в справочнике внизу листа.");
  ws.getRange(5, 7).setNote(`Содержание за ход\nБаза: ${fmtN(g(113))} мон. (бойцы × мон. за бойца)\nСкидка железа: ${fmtD(g(114) * 100, 0)}%\nСкидка Арсенала: ${fmtD(g(115) * 100, 0)}%\nМодификаторы: ${fmtS(g(129) * 100, 0)}%\nИтого: ${fmtN(g(116))} мон.` + (g(116) > g(31) ? `\n⚠ Больше дохода (${fmtN(g(31))})!` : ""));
  ws.getRange(5, 11).setNote(`Призыв: ${fmtN(g(42))} специалистов + ${fmtN(g(43))} сброда = ${fmtN(g(44))}\nВ отрядах: ${fmtN(g(112))}\nМожно набрать: ${fmtN(Math.max(0, g(44) - g(112)))}`);
}

function richRuns(text, runs) {
  let b = SpreadsheetApp.newRichTextValue().setText(text);
  runs.forEach(([a, z, color]) => { if (z > a) b = b.setTextStyle(a, z, SpreadsheetApp.newTextStyle().setForegroundColor(color).build()); });
  return b.build();
}

// Пояснения при наведении на «Статистике»: расшифровка каждого числа на текущий ход.
function refreshNotes() {
  const ss = SS_();
  const st = ss.getSheetByName("Статистика"), calc = ss.getSheetByName("Расчёты"), bld = ss.getSheetByName("Стройки");
  if (!st || !calc) return;
  const cv = calc.getRange(1, 2, 165, 3).getValues();          // Расчёты!B:D
  const g = r => Number(cv[r - 1][0]) || 0, gs = r => String(cv[r - 1][0] || ""), gc = r => Number(cv[r - 1][1]) || 0, gd = r => Number(cv[r - 1][2]) || 0;
  const pct = g(155);
  st.getRange("B5").setNote(`Население: ${fmtN(g(13))}\nПрирост за ход: ${fmtS(g(96))} чел. (${fmtS(g(95) * 100, 1)}%)\n• база: ${g(93) > 0 ? "+1% (есть излишек еды)" : "0% — нет излишка еды"}\n• кризисы: ${fmtS(-g(94) * 100, 1)} п.п.\n• модификаторы: ${fmtS(g(131) * 100, 1)} п.п.`);
  st.getRange("E5").setNote(`Казна сейчас: ${fmtN(g(150))}\n+ доход ${fmtN(g(31))} − ${pct}% в фонд стройки = ${fmtS(g(31) * (1 - pct / 100))}\n− содержание армии: ${fmtN(g(32))}\n− расходы по вердикту: ${fmtN(g(144))}\n± модификаторы: ${fmtS(g(135))}\n= за ход: ${fmtS(g(152))} → ${fmtN(g(150) + g(152))}`);
  st.getRange("H5").setNote(`Склад сейчас: ${fmtN(g(151))}\n+ ремесло ${fmtN(g(26))} − ${pct}% в фонд стройки = ${fmtS(g(26) * (1 - pct / 100))}\n− расходы по вердикту: ${fmtN(g(143))}\n± модификаторы: ${fmtS(g(136))}\n= за ход: ${fmtS(g(153))} → ${fmtN(g(151) + g(153))}`);
  st.getRange("K5").setNote(`Урожай: ${fmtN(g(21))} — крестьяне по 2 еды, соль, постройки, кризисы, модификаторы\nСъедается: ${fmtN(g(22))} — по 1 на жителя и ещё 2 на феодала\nИзлишек: ${fmtN(g(23))}. Голод — если излишек меньше 5% потребления (${fmtN(g(22) * 0.05)}).`);
  st.getRange("N5").setNote(`Единство: ${fmtD(g(39), 1)}%\nБаза 50 + священники ${fmtS(g(37), 2)} + камни, благовония, постройки ${fmtS(g(38), 2)}\n− кризисы ${fmtN(g(78))} ± модификаторы ${fmtS(g(132) + g(133), 1)}`);
  st.getRange("Q5").setNote(`Клирика сейчас: ${fmtD(g(105), 2)}\n+ за ход ${fmtD(g(103), 2)}: священники ${fmtD(g(100), 2)}, благовония ${fmtD(g(101), 2)}, храмы ${fmtD(g(102), 2)}, модификаторы ${fmtD(g(134), 2)}\n− потрачено в этом ходу: ${fmtD(g(104), 2)}\n= к концу хода: ${fmtD(g(106), 2)}\nУгроза: ${gs(107)}. Пороги: −5 предупреждение, −10 разрыв, −20 вторжение.`);
  const est = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
  st.getRange("E10").setNote("В конце хода лояльность изменится:\n" + est.map((e, i) => `${e}: ${fmtS(gd(85 + i))} (ручное ${fmtS(g(85 + i))}, кризисы и модификаторы ${fmtS(gc(85 + i))})`).join("\n") + "\nНиже 20% у феодалов — бунт, у священников — раскол.");
  const act = readModifiers().filter(x => x.d[2] === "АКТИВЕН");
  st.getRange("N18").setNote(act.length ? act.map(x => `${x.d[0]}: ${modEffectText(x.d)}` + (x.d[23] ? `\n   ${x.d[23]}` : "")).join("\n") : "Действующих модификаторов нет.");
}

function refreshAll() {
  try { refreshArmyView(); } catch (e) { console.log("refreshArmyView: " + e.message); }
  try { refreshBuildingsView(); } catch (e) { console.log("refreshBuildingsView: " + e.message); }
  try { refreshModifiersView(); } catch (e) { console.log("refreshModifiersView: " + e.message); }
  try { refreshNotes(); } catch (e) { console.log("refreshNotes: " + e.message); }
}

// Правки вручную сразу перерисовывают зависимые подсказки: армия, условия построек, текст эффектов.
function onEdit(e) {
  try {
    const sh = e && e.range && e.range.getSheet(); if (!sh) return;
    const name = sh.getName(), r = e.range.getRow();
    if (name === "Армия" && r >= ARMY_FIRST && r <= ARMY_REF_ROW + 10) refreshArmyView();
    else if (name === "Стройки" && r >= BLD_FIRST) refreshBuildingsView();
    else if (name === "Ресурсы") refreshBuildingsView();
    else if (name === "Модификаторы" && r >= MOD_FIRST) refreshModifiersView();
  } catch (err) {}
}

// ============================================================
// ЛИСТ "МОДИФИКАТОРЫ" — долгие эффекты вердиктов
// ============================================================
const MOD_FIRST = 5, MOD_LAST = 104, MOD_COLS = 26;
// Физическая колонка (1-based) для каждого поля модификатора. Поля (индексы d[0..23] в коде):
// 0 название, 1 тип, 2 статус, 3 ходов осталось, 4 прогресс %, 5 прогресс за ход, 6 еда %, 7 ремесло %, 8 доход %, 9 армия %,
// 10 призыв %, 11 прирост п.п., 12 единство, 13 единство/ход, 14-18 лояльность сословий/ход, 19 клирика/ход, 20 казна/ход,
// 21 склад/ход, 22 источник, 23 описание. D «Срок / прогресс» — формула, E «Эффекты» — пишет код.
const MOD_MAP = [1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 6, 7];
const MOD_SHOW = 4, MOD_FX = 5;
const MOD_HEADERS = ["НАЗВАНИЕ", "ТИП", "СТАТУС", "СРОК / ПРОГРЕСС", "ЭФФЕКТЫ (СОБИРАЮТСЯ САМИ)", "ИСТОЧНИК", "ОПИСАНИЕ / ПРИ ЗАВЕРШЕНИИ", "ХОДОВ ОСТАЛОСЬ", "ПРОГРЕСС %", "ПРОГРЕСС ЗА ХОД",
  "ЕДА %", "РЕМЕСЛО %", "ДОХОД %", "АРМИЯ %", "ПРИЗЫВ %", "ПРИРОСТ п.п.", "ЕДИНСТВО", "ЕДИНСТВО", "КРЕСТ.", "РЕМЕС.", "ТОРГ.", "СВЯЩ.", "ФЕОД.", "КЛИРИКА", "КАЗНА", "СКЛАД"];
const MOD_STATUSES = ["АКТИВЕН", "ОТКЛЮЧЁН", "ЗАВЕРШЁН", "ИСТЁК"];
function modL(k) { return colLetter(MOD_MAP[k]); }

function fillModifiersSheet(ss) {
  const ws = ss.getSheetByName("Модификаторы") || ss.insertSheet("Модификаторы");
  ws.setHiddenGridlines(true);
  const n = MOD_LAST - MOD_FIRST + 1;
  [190, 96, 92, 160, 330, 110, 240, 66, 66, 66].concat(new Array(16).fill(56)).forEach((w, i) => ws.setColumnWidth(i + 1, w));
  sheetTitle(ws, MOD_COLS, "Указы и эффекты", `="АКТИВНО: "&COUNTIF(C${MOD_FIRST}:C${MOD_LAST},"АКТИВЕН")`, 3);
  styleOrnament(ws, 2);
  ws.getRange(3, 1, 1, 10).merge();
  ws.getRange(3, 1).setValue("Долгие эффекты вердиктов. Считаются только строки со статусом АКТИВЕН. Числа — справа: проценты числом (−25 = −25%). Временный: «Ходов осталось» уменьшается, на 0 → ИСТЁК. Проект: прогресс растёт на «Прогресс за ход», на 100% → ЗАВЕРШЁН (запись в Хронике).")
    .setWrap(true).setFontSize(10).setFontFamily(FONT_BODY).setFontColor(C.muted).setVerticalAlignment("middle");
  ws.setRowHeight(3, 44);
  groupHead(ws, 3, 11, 7, "ПОКА ДЕЙСТВУЕТ"); groupHead(ws, 3, 18, 9, "КАЖДЫЙ ХОД");
  MOD_HEADERS.forEach((h, i) => ws.getRange(4, i + 1).setValue(h)); styleHeaderRow(ws, 4, 1, MOD_COLS);
  ws.getRange(4, 1, 1, 7).setHorizontalAlignment("left");
  const show = []; for (let r = MOD_FIRST; r <= MOD_LAST; r++) show.push([F(`=IF(A${r}="","",IF(C${r}<>"АКТИВЕН",IF(C${r}="ЗАВЕРШЁН","завершён","—"),IF(B${r}="Проект",REPT("█",ROUND(MIN(100,N(I${r}))/10))&REPT("░",10-ROUND(MIN(100,N(I${r}))/10))&" "&N(I${r})&"%"&IF(J${r}<>""," +"&J${r},""),IF(H${r}<>"",IF(H${r}=1,"остался 1 ход","осталось ходов: "&H${r}),"бессрочно"))))`)]);
  ws.getRange(MOD_FIRST, MOD_SHOW, n, 1).setFormulas(show);
  const body = ws.getRange(MOD_FIRST, 1, n, MOD_COLS);
  body.setFontFamily(FONT_BODY).setFontSize(11).setFontColor(C.text).setVerticalAlignment("middle").setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  [1, 2, 3, 6, 7].concat([8, 9, 10], Array.from({ length: 16 }, (_, k) => 11 + k)).forEach(c => ws.getRange(MOD_FIRST, c, n, 1).setBackground(C.input));
  ws.getRange(MOD_FIRST, 1, n, 1).setFontWeight("bold");
  ws.getRange(MOD_FIRST, 3, n, 1).setFontFamily(FONT_TITLE).setFontSize(9).setFontWeight("bold").setHorizontalAlignment("center");
  ws.getRange(MOD_FIRST, MOD_SHOW, n, 1).setFontColor(C.muted).setFontSize(10);
  ws.getRange(MOD_FIRST, MOD_FX, n, 1).setWrap(true).setFontSize(10);
  ws.getRange(MOD_FIRST, 6, n, 1).setFontColor(C.muted).setFontSize(10);
  ws.getRange(MOD_FIRST, 7, n, 1).setWrap(true).setFontSize(10);
  ws.getRange(MOD_FIRST, 8, n, 19).setHorizontalAlignment("center");
  ws.getRange(MOD_FIRST, 2, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Постоянный", "Временный", "Проект"], true).build());
  ws.getRange(MOD_FIRST, 3, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MOD_STATUSES, true).build());
  ws.getRange(MOD_FIRST, 8, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).build());
  ws.getRange(MOD_FIRST, 9, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 100).build());
  const st = ws.getRange(MOD_FIRST, 3, n, 1), nums = ws.getRange(MOD_FIRST, 11, n, 16);
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("АКТИВЕН").setBackground(C.greenBg).setFontColor(C.green).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ЗАВЕРШЁН").setBackground("#2A2213").setFontColor(C.gold).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ИСТЁК").setFontColor(C.muted).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ОТКЛЮЧЁН").setFontColor(C.muted).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=($C${MOD_FIRST}<>"АКТИВЕН")*($A${MOD_FIRST}<>"")>0`).setFontColor(C.muted).setRanges([ws.getRange(MOD_FIRST, 1, n, 2), ws.getRange(MOD_FIRST, MOD_FX, n, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C.red).setRanges([nums]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(C.green).setRanges([nums]).build()]);
  ws.setFrozenRows(4);   // столбцы не закрепляются: строки 1 и 3 — объединённые ячейки
  paintParchment(ws, MOD_LAST + 2, MOD_COLS);
  return ws;
}

function ensureModifiersSheet() {
  const ss = SS_();
  return ss.getSheetByName("Модификаторы") || fillModifiersSheet(ss);
}

// Строки модификаторов с номерами строк листа; d — поля в порядке MOD_MAP (не зависит от расположения колонок).
function readModifiers() {
  const ws = ensureModifiersSheet();
  return ws.getRange(MOD_FIRST, 1, MOD_LAST - MOD_FIRST + 1, MOD_COLS).getValues()
    .map((raw, i) => ({ row: MOD_FIRST + i, d: MOD_MAP.map(c => raw[c - 1]) })).filter(x => String(x.d[0]).trim() !== "");
}

// Колонка «Эффекты»: числа строки словами.
function refreshModifiersView() {
  const ws = SS_().getSheetByName("Модификаторы"); if (!ws) return;
  const n = MOD_LAST - MOD_FIRST + 1, out = []; for (let i = 0; i < n; i++) out.push([""]);
  readModifiers().forEach(x => { out[x.row - MOD_FIRST][0] = modEffectText(x.d, true) + (x.d[2] === "ЗАВЕРШЁН" && x.d[23] ? "" : ""); });
  ws.getRange(MOD_FIRST, MOD_FX, n, 1).setValues(out);
}

// Короткое описание эффектов строки: «Доход −25%, Единство −5/ход…»
function modEffectText(d, compact) {
  const out = []; const sg = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + String(Math.abs(x)).replace(".", ",");
  const pct = [[6, "Еда"], [7, "Ремесло"], [8, "Доход"], [9, "Армия"], [10, "Призыв"]];
  pct.forEach(([i, n]) => { const v = Number(d[i]) || 0; if (v) out.push(`${n} ${sg(v)}%`); });
  if (Number(d[11])) out.push(`Прирост ${sg(Number(d[11]))} п.п.`);
  if (Number(d[12])) out.push(`Единство ${sg(Number(d[12]))}`);
  if (Number(d[13])) out.push(`Единство ${sg(Number(d[13]))}/ход`);
  [[14, "крестьяне"], [15, "ремесленники"], [16, "торговцы"], [17, "священники"], [18, "феодалы"]].forEach(([i, n]) => { const v = Number(d[i]) || 0; if (v) out.push(`Лояльность (${n}) ${sg(v)}/ход`); });
  [[19, "Клирика"], [20, "Казна"], [21, "Склад"]].forEach(([i, n]) => { const v = Number(d[i]) || 0; if (v) out.push(`${n} ${sg(v)}/ход`); });
  if (!compact && String(d[1]) === "Проект") out.push(`прогресс ${Number(d[4]) || 0}% (+${Number(d[5]) || 0}%/ход)`);
  if (!compact && d[3] !== "" && !isNaN(Number(d[3]))) out.push(`осталось ходов: ${Number(d[3])}`);
  if (compact && !out.length) return String(d[1]) === "Проект" ? "При завершении — см. описание" : "без числовых эффектов";
  return out.join(", ") || "без числовых эффектов";
}

// Что произойдёт с модификаторами в конце хода (без изменений — для превью).
function planModifiers() {
  const active = [], ending = []; let unityStep = 0;
  readModifiers().forEach(({ row, d }) => {
    if (d[2] !== "АКТИВЕН") return;
    active.push({ row, name: String(d[0]), effects: modEffectText(d) });
    unityStep += Number(d[13]) || 0;
    const step = Number(d[5]) || 0;
    if (step && (Number(d[4]) || 0) + step >= 100) ending.push({ name: String(d[0]), kind: "завершится", note: String(d[23] || "") });
    if (d[3] !== "" && !isNaN(Number(d[3])) && Number(d[3]) - 1 <= 0) ending.push({ name: String(d[0]), kind: "истечёт", note: String(d[23] || "") });
  });
  return { active, ending, unityStep };
}

// Тик модификаторов в конце хода: прогресс проектов, срок временных, накопление «Единство/ход».
function tickModifiers(turn) {
  const ss = SS_(); const ws = ensureModifiersSheet(); const calc = ss.getSheetByName("Расчёты");
  let unityStep = 0; const events = [];
  readModifiers().forEach(({ row, d }) => {
    if (d[2] !== "АКТИВЕН") return;
    unityStep += Number(d[13]) || 0;
    let status = "АКТИВЕН";
    const step = Number(d[5]) || 0;
    if (step) {
      let prog = (Number(d[4]) || 0) + step;
      if (prog >= 100) { prog = 100; status = "ЗАВЕРШЁН"; events.push({ name: String(d[0]), kind: "Завершено", note: String(d[23] || "") }); }
      ws.getRange(row, MOD_MAP[4]).setValue(prog);
    }
    if (d[3] !== "" && !isNaN(Number(d[3]))) {
      const left = Math.max(0, Number(d[3]) - 1);
      ws.getRange(row, MOD_MAP[3]).setValue(left);
      if (left <= 0 && status === "АКТИВЕН") { status = "ИСТЁК"; events.push({ name: String(d[0]), kind: "Истёк срок", note: String(d[23] || "") }); }
    }
    if (status !== "АКТИВЕН") ws.getRange(row, MOD_MAP[2]).setValue(status);
  });
  if (unityStep && calc) calc.getRange("B133").setValue((Number(calc.getRange("B133").getValue()) || 0) + unityStep);
  events.forEach(e => { try { writeChronicle(1200 + turn, turn, e.kind + ": " + e.name, e.note || "—"); } catch (err) {} });
  return events;
}

// Добавить модификатор программно (для панелей / будущих инструментов). m — объект с полями по MOD_HEADERS.
function addModifier(m) {
  const ws = ensureModifiersSheet();
  const used = readModifiers().map(x => x.row);
  let row = MOD_FIRST; while (used.indexOf(row) >= 0 && row <= MOD_LAST) row++;
  if (row > MOD_LAST) throw new Error("Лист «Модификаторы» заполнен (100 строк)");
  const keys = ["name", "type", "status", "turns", "progress", "progressStep", "food", "craft", "income", "army", "levy", "growth", "unity", "unityPerTurn",
    "loyPeasants", "loyCrafters", "loyMerchants", "loyPriests", "loyNobles", "clericPerTurn", "treasuryPerTurn", "storePerTurn", "source", "note"];
  const vals = keys.map(k => m[k] === undefined || m[k] === null ? "" : m[k]);
  if (!vals[1]) vals[1] = "Постоянный"; if (!vals[2]) vals[2] = "АКТИВЕН";
  const phys = new Array(MOD_COLS).fill(""); MOD_MAP.forEach((c, k) => phys[c - 1] = vals[k]);
  ws.getRange(row, 1, 1, 3).setValues([phys.slice(0, 3)]);               // D — формула, E — пишет код: их не трогаем
  ws.getRange(row, 6, 1, MOD_COLS - 5).setValues([phys.slice(5)]);
  try { refreshModifiersView(); } catch (e) {}
  return row;
}

function getModifiersForPanel() {
  return readModifiers().filter(x => x.d[2] === "АКТИВЕН").map(x => ({ name: String(x.d[0]), type: String(x.d[1] || ""), effects: modEffectText(x.d), note: String(x.d[23] || "") }));
}

// ============================================================
// ЛИСТ "РЕГИОНЫ"
// ============================================================
function ensureRegionsSheet(forceNew) {
  const ss = SS_(); 
  let ws = ss.getSheetByName("Регионы"); 
  if (ws && !forceNew) return ws; 
  
  if (ws && forceNew) {
    ws.getRange(1, 1, ws.getMaxRows(), ws.getMaxColumns()).breakApart();
    ws.clear(); // Очищаем, но НЕ удаляем, чтобы не сломать ссылки в других листах
    ws.getCharts().forEach(c => ws.removeChart(c));
  } else {
    ws = ss.insertSheet("Регионы");
  }

  ws.setHiddenGridlines(true); 
  sheetTitle(ws, 18, "Регионы государства", '="РЕГИОНОВ: "&COUNTA(A4:A21)&" ИЗ 18"');
  ws.setRowHeight(2, 24);
  groupHead(ws, 2, 4, 5, "СОСЛОВИЯ"); groupHead(ws, 2, 9, 6, "ЛОЯЛЬНОСТЬ, %"); groupHead(ws, 2, 15, 3, "ЗА ГОД");
  const headers = ["РЕГИОН", "ТИП", "НАСЕЛ.", "КРЕСТ.", "РЕМЕС.", "ТОРГ.", "СВЯЩ.", "ФЕОД.", "КР", "РЕМ", "ТОРГ", "СВЯЩ", "ФЕОД", "СРЕДН.", "ЕДА", "РЕМЕСЛО", "ТОРГОВЛЯ", "ПОСТРОЙКИ"];
  headers.forEach((h, i) => ws.getRange(3, i + 1).setValue(h)); 
  styleHeaderRow(ws, 3, 1, 18);
  
  ws.getRange(4, 1).setValue("Столица").setFontWeight("bold").setFontFamily(FONT_BODY);
  ws.getRange(4, 2).setValue("Столица").setHorizontalAlignment("center");
  ws.getRange(4, 3).setFormula(F("=IF(COUNT(D4:H4)>0,SUM(D4:H4),\"\")")).setHorizontalAlignment("center");
  ws.getRange(4, 4).setValue(45000).setHorizontalAlignment("center");
  ws.getRange(4, 5).setValue(3000).setHorizontalAlignment("center");
  ws.getRange(4, 6).setValue(750).setHorizontalAlignment("center");
  ws.getRange(4, 7).setValue(750).setHorizontalAlignment("center");
  ws.getRange(4, 8).setValue(500).setHorizontalAlignment("center");
  for (let c = 9; c <= 13; c++) ws.getRange(4, c).setValue(55).setHorizontalAlignment("center");
  ws.getRange(4, 14).setFormula(F("=IF(SUM(D4:H4)>0,(D4*I4+E4*J4+F4*K4+G4*L4+H4*M4)/SUM(D4:H4),\"\")")).setNumberFormat('0"%"').setHorizontalAlignment("center").setFontWeight("bold");
  ws.getRange(4, 15).setFormula(F("=IF(D4>0,D4*2*(1+'Расчёты'!$B$52)*(1+'Расчёты'!$C$201)*'Расчёты'!$B$79,0)")).setHorizontalAlignment("center");
  ws.getRange(4, 16).setFormula(F("=IF(E4>0,E4/10*(1+'Расчёты'!$B$51)*(1+'Расчёты'!$C$202)*'Расчёты'!$B$80,0)")).setHorizontalAlignment("center");
  ws.getRange(4, 17).setFormula(F("=IF(F4>0,F4*(1+'Расчёты'!$B$54)*(1+'Расчёты'!$C$203)*'Расчёты'!$B$81,0)")).setHorizontalAlignment("center");
  ws.getRange(4, 18).setValue("").setWrap(true).setFontFamily(FONT_BODY);
  for (let c = 1; c <= 18; c++) { ws.getRange(4, c).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); }

  for (let r = 5; r <= 21; r++) {
    ws.getRange(r, 3).setFormula(F(`=IF(COUNT(D${r}:H${r})>0,SUM(D${r}:H${r}),"")`)).setHorizontalAlignment("center");
    ws.getRange(r, 14).setFormula(F(`=IF(SUM(D${r}:H${r})>0,(D${r}*I${r}+E${r}*J${r}+F${r}*K${r}+G${r}*L${r}+H${r}*M${r})/SUM(D${r}:H${r}),"")`)).setNumberFormat('0"%"').setHorizontalAlignment("center");
    ws.getRange(r, 15).setFormula(F(`=IF(D${r}>0,D${r}*2*(1+'Расчёты'!$B$52)*(1+'Расчёты'!$C$201)*'Расчёты'!$B$79,0)`)).setHorizontalAlignment("center");
    ws.getRange(r, 16).setFormula(F(`=IF(E${r}>0,E${r}/10*(1+'Расчёты'!$B$51)*(1+'Расчёты'!$C$202)*'Расчёты'!$B$80,0)`)).setHorizontalAlignment("center");
    ws.getRange(r, 17).setFormula(F(`=IF(F${r}>0,F${r}*(1+'Расчёты'!$B$54)*(1+'Расчёты'!$C$203)*'Расчёты'!$B$81,0)`)).setHorizontalAlignment("center");
    for (let c = 1; c <= 18; c++) { ws.getRange(r, c).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID); }
  }

  const totalRow = 22; styleBanner(ws, totalRow, 1, 18, "И Т О Г О   П О   Г О С У Д А Р С Т В У"); 
  const tr = totalRow + 1;
  ws.getRange(tr, 1).setValue("ВСЕГО").setFontWeight("bold");
  ws.getRange(tr, 3).setFormula(F("=SUM(C4:C21)")).setFontWeight("bold").setHorizontalAlignment("center");
  ws.getRange(tr, 4).setFormula(F("=SUM(D4:D21)")).setHorizontalAlignment("center");
  ws.getRange(tr, 5).setFormula(F("=SUM(E4:E21)")).setHorizontalAlignment("center");
  ws.getRange(tr, 6).setFormula(F("=SUM(F4:F21)")).setHorizontalAlignment("center");
  ws.getRange(tr, 7).setFormula(F("=SUM(G4:G21)")).setHorizontalAlignment("center");
  ws.getRange(tr, 8).setFormula(F("=SUM(H4:H21)")).setHorizontalAlignment("center");
  ws.getRange(tr, 9).setFormula(F("=IF(D23>0,SUMPRODUCT(D4:D21,I4:I21)/D23,0)")).setNumberFormat('0"%"').setHorizontalAlignment("center");
  ws.getRange(tr, 10).setFormula(F("=IF(E23>0,SUMPRODUCT(E4:E21,J4:J21)/E23,0)")).setNumberFormat('0"%"').setHorizontalAlignment("center");
  ws.getRange(tr, 11).setFormula(F("=IF(F23>0,SUMPRODUCT(F4:F21,K4:K21)/F23,0)")).setNumberFormat('0"%"').setHorizontalAlignment("center");
  ws.getRange(tr, 12).setFormula(F("=IF(G23>0,SUMPRODUCT(G4:G21,L4:L21)/G23,0)")).setNumberFormat('0"%"').setHorizontalAlignment("center");
  ws.getRange(tr, 13).setFormula(F("=IF(H23>0,SUMPRODUCT(H4:H21,M4:M21)/H23,0)")).setNumberFormat('0"%"').setHorizontalAlignment("center");
  ws.getRange(tr, 14).setFormula(F(`=IF(C${tr}>0,(D${tr}*I${tr}+E${tr}*J${tr}+F${tr}*K${tr}+G${tr}*L${tr}+H${tr}*M${tr})/C${tr},0)`)).setNumberFormat('0"%"').setFontWeight("bold").setHorizontalAlignment("center");
  ws.getRange(tr, 15).setFormula(F("=SUM(O4:O21)")).setFontWeight("bold").setHorizontalAlignment("center");
  ws.getRange(tr, 16).setFormula(F("=SUM(P4:P21)")).setFontWeight("bold").setHorizontalAlignment("center");
  ws.getRange(tr, 17).setFormula(F("=SUM(Q4:Q21)")).setFontWeight("bold").setHorizontalAlignment("center");
  for (let c = 1; c <= 18; c++) { ws.getRange(tr, c).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID_MEDIUM); ws.getRange(tr, c).setBackground(C.bannerBg); }

  [150, 100, 82, 74, 66, 58, 58, 54, 46, 46, 46, 46, 46, 58, 84, 74, 74, 260].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  const reg = ws.getRange(4, 1, 18, 18);
  reg.setFontFamily(FONT_BODY).setFontSize(11).setFontColor(C.text).setVerticalAlignment("middle").setBorder(false, false, false, false, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  ws.setRowHeights(4, 18, 28);
  [[1, 2], [4, 5], [9, 5], [18, 1]].forEach(([c, k]) => ws.getRange(4, c, 18, k).setBackground(C.input));
  ws.getRange(4, 1, 18, 1).setFontWeight("bold");
  ws.getRange(4, 3, 20, 6).setNumberFormat("#,##0").setHorizontalAlignment("right"); ws.getRange(4, 15, 20, 3).setNumberFormat("#,##0").setHorizontalAlignment("right");
  ws.getRange(4, 3, 18, 1).setFontColor(C.gold); ws.getRange(4, 9, 20, 6).setHorizontalAlignment("center");
  ws.getRange(4, 18, 18, 1).setFontSize(10).setFontColor(C.muted).setWrap(true);
  ws.getRange(23, 1, 1, 18).setFontFamily(FONT_BODY).setFontSize(12).setFontColor(C.gold);
  ws.clearConditionalFormatRules(); const rules = []; 
  [ws.getRange("I4:M21"), ws.getRange("N4:N21")].forEach(rng => { 
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(30).setBackground(C.redBg).setFontColor(C.red).setRanges([rng]).build()); 
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(30, 70).setBackground(C.input).setFontColor(C.gold).setRanges([rng]).build()); 
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(70).setBackground(C.greenBg).setFontColor(C.green).setRanges([rng]).build()); 
  }); 
  ws.setConditionalFormatRules(rules); 
  paintParchment(ws, 25, 18); 
  return ws;
}

// ============================================================
// ЛОГИКА ХОДА
// ============================================================
// Последняя строка, где в колонке col стоит число > 0 (для Журнала — последний применённый ход).
function findLastFilledRow(sheet, col) {
  const last = sheet.getLastRow();
  if (last < 1) return 1;
  const vals = sheet.getRange(1, col, last, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i][0];
    if (v !== "" && v !== null && typeof v !== "boolean" && !isNaN(Number(v)) && Number(v) > 0) return i + 1;
  }
  return 1;
}

// Номер последнего применённого хода (0 — игра только начата).
function getCurrentTurn() {
  const j = SS_().getSheetByName("Журнал");
  if (!j) return 0;
  return Number(j.getRange(findLastFilledRow(j, 2), 1).getValue()) || 0;
}

// Остатки на конец последнего применённого хода: фонд стройки, склад, казна.
function getPools() {
  const j = SS_().getSheetByName("Журнал");
  if (!j) return { fundRem: 0, fundMon: 0, sklad: 0, kazna: 0 };
  const v = j.getRange(findLastFilledRow(j, 2), 1, 1, 18).getValues()[0];
  const r = x => Math.round(Number(x) || 0);
  return { fundRem: r(v[8]), fundMon: r(v[9]), sklad: r(v[14]), kazna: r(v[17]) };
}
function getFunds() { const p = getPools(); return { rem: p.fundRem, mon: p.fundMon }; }

// Расходы по вердикту текущего хода: Расчёты!B143 (склад), B144 (казна), B104 (клирика). Их заполняет Мастер хода.
function getTurnCosts() {
  const calc = SS_().getSheetByName("Расчёты");
  if (!calc) return { rem: 0, mon: 0, cleric: 0 };
  const pos = x => Math.max(0, Number(x) || 0);
  const v = calc.getRange("B143:B144").getValues();
  return { rem: pos(v[0][0]), mon: pos(v[1][0]), cleric: pos(calc.getRange("B104").getValue()) };
}

// Настройки автостройки — поля на панели «Автостройка» листа «Стройки»: O4 — бюджет, O8 — лимит построек за ход.
function findSetting(bld, lastB, labelPart, def, max) {
  const v = bld.getRange(labelPart.indexOf("Бюджет") >= 0 ? BLD_BUDGET : BLD_MAXTURN).getValue();
  const n = Number(v);
  return (v === "" || isNaN(n) || n < 0 || (max !== undefined && n > max)) ? def : n;
}

function findBudgetPct(bld, lastB) { return findSetting(bld, lastB, "Бюджет стройки", 30, 100); }

// Ресурсы в колонке «ТРЕБУЕТ»: «Соль 1», «уголь 1, железо 1», «Благов. 2 Железо 2», «Драг камни 1»…
// Число — сколько источников ресурса должно быть на листе «Ресурсы» (ресурс не тратится).
const RES_KEYS = [["соль", 8], ["угол", 7], ["драг", 6], ["камн", 6], ["желез", 5], ["золот", 4], ["шёл", 10], ["шел", 10], ["благ", 9]];
function parseRequirements(text) {
  const out = []; const re = /([^\d,]+?)\s*(\d+)/g; let m;
  const src = String(text || "");
  while ((m = re.exec(src))) {
    const label = m[1].trim(); const key = label.toLowerCase();
    const hit = RES_KEYS.find(([k]) => key.indexOf(k) >= 0);
    out.push({ name: label, row: hit ? hit[1] : 0, need: Number(m[2]) });
  }
  return out;
}
function getResourceCounts() {
  const res = SS_().getSheetByName("Ресурсы");
  const map = {}; if (!res) return map;
  res.getRange(4, 2, 7, 1).getValues().forEach((r, i) => { map[4 + i] = Number(r[0]) || 0; });
  return map;
}

// Жадная стройка по приоритету: каждое здание строится столько раз, сколько позволяют фонд и свободные слоты.
// maxPerTurn > 0 ограничивает общее число построек за ход (настройка на листе «Стройки»), 0 — без лимита.
function autoBuild(bld, firstB, lastB, availRem, availMon, maxPerTurn) {
  const data = bld.getRange(firstB, 1, lastB - firstB + 1, 16).getValues();
  const builtByName = {}; data.forEach(r => { builtByName[String(r[1])] = Number(r[10]) || 0; });
  const resCount = getResourceCounts();
  const items = [], blocked = [];
  data.forEach((r, i) => {
    if (Number(r[13]) !== 1) return;
    const it = { row: firstB + i, name: String(r[1]), rem: Number(r[2]) || 0, mon: Number(r[3]) || 0, prio: Number(r[14]) || 100, freeSlots: Number(r[15]) || 0 };
    if (it.freeSlots <= 0) return;
    const chain = String(r[5] || "").trim();
    if (chain && !(builtByName[chain] > 0)) { blocked.push({ name: it.name, row: it.row, reason: "нужно здание «" + chain + "»" }); return; }
    const lack = parseRequirements(r[4]).filter(q => !q.row || (resCount[q.row] || 0) < q.need);
    if (lack.length) { blocked.push({ name: it.name, row: it.row, reason: "нужно: " + lack.map(q => q.name + " " + q.need).join(", ") }); return; }
    items.push(it);
  });
  items.sort((a, b) => (a.prio - b.prio) || (a.row - b.row));
  let remLeft = availRem, monLeft = availMon;
  const built = [];
  let spentRem = 0, spentMon = 0;
  let capLeft = maxPerTurn > 0 ? maxPerTurn : Infinity;

  items.forEach(it => {
    if (capLeft <= 0) return;
    const byRem = it.rem > 0 ? Math.floor(remLeft / it.rem) : Infinity;
    const byMon = it.mon > 0 ? Math.floor(monLeft / it.mon) : Infinity;
    const count = Math.min(byRem, byMon, it.freeSlots, capLeft);
    if (!(count > 0) || !isFinite(count)) return;
    const costRem = count * it.rem, costMon = count * it.mon;
    remLeft -= costRem; monLeft -= costMon; spentRem += costRem; spentMon += costMon; capLeft -= count;
    built.push({ name: it.name, count, row: it.row, costRem, costMon });
  });
  return { built, spentRem, spentMon, blocked };
}

// Колонка Q «ПЛАН ХОДА»: сколько построит ближайший ход; «ждёт» — включено в автостройку, но не выполнены условия.
function writeBuildPlan(built, blocked) {
  const bld = SS_().getSheetByName("Стройки"); if (!bld) return;
  const L = bldLayout(), isB = {}; L.rows.forEach(r => isB[r] = true);
  const vals = []; for (let r = BLD_FIRST; r <= L.last; r++) vals.push([isB[r] ? 0 : ""]);
  (blocked || []).forEach(b => { if (isB[b.row]) vals[b.row - BLD_FIRST][0] = "ждёт"; });
  (built || []).forEach(b => { if (isB[b.row]) vals[b.row - BLD_FIRST][0] = b.count; });
  bld.getRange(BLD_FIRST, 17, vals.length, 1).setValues(vals);
}

function computeTurn() {
  const ss = SS_();
  const calc = ss.getSheetByName("Расчёты");
  const journal = ss.getSheetByName("Журнал");
  const bld = ss.getSheetByName("Стройки");
  const props = DOCPROPS_();

  const cv = calc.getRange(1, 2, 141, 1).getValues();          // Расчёты!B1:B141 одним запросом
  const num = (row) => { const n = Number(cv[row - 1][0]); return isNaN(n) ? 0 : n; };

  const population = num(13);
  const foodCons = num(22);
  const foodStock = num(23);
  const popPct = num(95);
  const popGrowth = num(96);
  const cleric = num(105);
  const clericSpent = num(104);
  const clericGrowth = num(103);
  const loyaltyFeud = num(63);
  const remIncome = num(26);
  const monIncome = num(31);
  const upkeep = num(32);
  const loyDelta = calc.getRange(85, 4, 5, 1).getValues().map(r => Number(r[0]) || 0);   // «Итог» изменения лояльности

  const isGolod = foodStock < foodCons * 0.05;
  const isBunt = loyaltyFeud < 20;

  const lastRow = findLastFilledRow(journal, 2);
  const jrow = journal.getRange(lastRow, 1, 1, 18).getValues()[0];
  const fundRem = Number(jrow[8]) || 0;
  const fundMon = Number(jrow[9]) || 0;
  const sklad = Number(jrow[14]) || 0;
  const kazna = Number(jrow[17]) || 0;
  const newTurn = (Number(jrow[0]) || 0) + 1;

  const firstB = parseInt(props.getProperty("FIRST_B_ROW")) || BLD_FIRST;
  const lastB = parseInt(props.getProperty("LAST_B_ROW")) || bldLayout().last;
  const budgetPct = findBudgetPct(bld, lastB);
  const maxPerTurn = findSetting(bld, lastB, "Макс. построек", 0);

  const fundInRem = remIncome * budgetPct / 100;
  const fundInMon = monIncome * budgetPct / 100;
  const availRem = fundRem + fundInRem;
  const availMon = fundMon + fundInMon;

  // Остаток дохода — на склад и в казну; с казны списывается армия и расходы вердикта.
  const costs = getTurnCosts();
  const storeInRem = remIncome - fundInRem;
  const storeInMon = monIncome - fundInMon;
  const modMon = num(135), modRem = num(136);                 // «Казна/ход», «Склад/ход» активных модификаторов
  const newSklad = sklad + storeInRem - costs.rem + modRem;
  const newKazna = kazna + storeInMon - upkeep - costs.mon + modMon;
  const mods = planModifiers();

  const buildResult = autoBuild(bld, firstB, lastB, availRem, availMon, maxPerTurn);

  const warnings = [];
  if (newKazna < 0) warnings.push("Казна уйдёт в минус: " + Math.round(newKazna));
  if (newSklad < 0) warnings.push("Склад уйдёт в минус: " + Math.round(newSklad));
  if (cleric + clericGrowth - clericSpent <= -5) warnings.push("Клирика уходит в минус — угроза разрыва");

  const ESTATES = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
  const loyalty = {}; ESTATES.forEach((k, i) => loyalty[k] = loyDelta[i]);

  return {
    newTurn, population,
    newPopulation: Math.round(population + popGrowth),
    popGrowth: Math.round(popGrowth), popPct,
    cleric, clericSpent, newCleric: cleric + clericGrowth - clericSpent, clericGrowth,
    fundRem, fundMon, fundInRem, fundInMon, availRem, availMon,
    sklad, kazna, storeInRem, storeInMon, upkeep, costRem: costs.rem, costMon: costs.mon, newSklad, newKazna,
    loyalty, loyDelta, modMon, modRem, modifiers: mods,
    spentRem: buildResult.spentRem, spentMon: buildResult.spentMon,
    remIncome, monIncome, budgetPct, maxPerTurn,
    buildings: buildResult.built, blocked: buildResult.blocked, warnings,
    golod: isGolod ? "ДА" : "НЕТ",
    bunt: isBunt ? "ДА" : "НЕТ",
  };
}

function applyTurn(p) {
  const ss = SS_();
  const journal = ss.getSheetByName("Журнал");
  const bld = ss.getSheetByName("Стройки");
  const calc = ss.getSheetByName("Расчёты");
  const reg = ss.getSheetByName("Регионы");
  const st = ss.getSheetByName("Статистика");

  const lastRow = findLastFilledRow(journal, 2);
  const newRow = lastRow + 1;

  const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
  writeJournalFormulas(journal, newRow, lastRow);
  styleJournalRows(journal, newRow, 1);
  journal.getRange(newRow, 1).setValue(p.newTurn);
  journal.getRange(newRow, 2).setValue(p.newPopulation);
  // Фонд: доля дохода по бюджету стройки (как в превью).
  journal.getRange(newRow, 5).setValue(r2(p.fundInRem));
  journal.getRange(newRow, 6).setValue(r2(p.fundInMon));
  journal.getRange(newRow, 7).setValue(p.spentRem);
  journal.getRange(newRow, 8).setValue(p.spentMon);
  journal.getRange(newRow, 11).setValue(p.buildings.map(b => `${b.name}+${b.count}`).join(", "));
  journal.getRange(newRow, 12).setValue(`Доход: ${Math.round(p.remIncome)} рем., ${Math.round(p.monIncome)} мон.; в фонд ${p.budgetPct}%; армия −${Math.round(p.upkeep)} мон.`);
  // Склад и казна: остаток дохода минус расходы.
  journal.getRange(newRow, 13).setValue(r2(p.storeInRem + Math.max(0, p.modRem)));
  journal.getRange(newRow, 14).setValue(r2(p.costRem + Math.max(0, -p.modRem)));
  journal.getRange(newRow, 16).setValue(r2(p.storeInMon + Math.max(0, p.modMon)));
  journal.getRange(newRow, 17).setValue(r2(p.upkeep + p.costMon + Math.max(0, -p.modMon)));

  p.buildings.forEach(b => {
    const cur = Number(bld.getRange(b.row, 11).getValue()) || 0;
    bld.getRange(b.row, 11).setValue(cur + b.count);
  });
  writeBuildPlan([]);
  tickModifiers(p.newTurn);

  if (reg && p.popGrowth !== 0) distributePopGrowthToRegions(reg, p.popGrowth);
  // Лояльность: «Итог» блока «Изменение лояльности» применяется ко всем регионам (0…100), ручные поправки обнуляются.
  if (reg && p.loyDelta.some(d => d !== 0)) {
    const data = reg.getRange(4, 1, 18, 13).getValues();
    data.forEach((d, i) => {
      if (!d[0]) return;
      const vals = [0, 1, 2, 3, 4].map(k => Math.max(0, Math.min(100, (Number(d[8 + k]) || 0) + p.loyDelta[k])));
      reg.getRange(4 + i, 9, 1, 5).setValues([vals]);
    });
  }
  calc.getRange(85, 2, 5, 1).setValues([[0], [0], [0], [0], [0]]);
  // Клирика: начало следующего хода = начало + прирост − потрачено; счётчики расходов обнуляются.
  calc.getRange("B105").setValue(Math.round(p.newCleric * 100) / 100);
  calc.getRange("B104").setValue(0);
  calc.getRange("B143:B144").setValues([[0], [0]]);
  DOCPROPS_().setProperty("LAST_TURN_DATE", new Date().toISOString());
  SpreadsheetApp.flush();

  if (p.golod === "ДА") toast_(ss, "Внимание: Голод!", "Кризис", 10);
  if (p.bunt === "ДА") toast_(ss, "Внимание: Бунт феодалов!", "Кризис", 10);
  if (p.newKazna < 0) toast_(ss, "Казна в минусе: " + Math.round(p.newKazna), "Казна", 10);
  refreshAll();
}

function previewText(p) {
  const sf = (n, d) => { const x = Number(n); return isNaN(x) ? "0" : x.toFixed(d); };
  const r = n => Math.round(Number(n) || 0);
  const loy = Object.keys(p.loyalty).filter(k => p.loyalty[k]).map(k => `${k} ${p.loyalty[k] > 0 ? "+" : ""}${p.loyalty[k]}`).join(", ") || "без изменений";
  return [
    `ХОД ${p.newTurn}`, "",
    `Население: ${p.population} → ${p.newPopulation} (${p.popGrowth >= 0 ? "+" : ""}${p.popGrowth}, ${sf(p.popPct * 100, 2)}%)`,
    `Клирика: ${sf(p.cleric, 2)} → ${sf(p.newCleric, 2)} (+${sf(p.clericGrowth, 2)}, −${sf(p.clericSpent, 2)})`, "",
    `Фонд стройки: ${r(p.fundRem)} рем. / ${r(p.fundMon)} мон. (+${r(p.fundInRem)} / +${r(p.fundInMon)})`,
    `Склад: ${r(p.sklad)} → ${r(p.newSklad)}`,
    `Казна: ${r(p.kazna)} → ${r(p.newKazna)} (армия −${r(p.upkeep)})`,
    `Лояльность: ${loy}`,
    `Модификаторы: активно ${p.modifiers.active.length}` + (p.modifiers.ending.length ? "; " + p.modifiers.ending.map(e => `${e.name} ${e.kind}`).join(", ") : ""), "",
    "СТРОЙКА:",
    p.buildings.length ? p.buildings.map(b => `  ${b.name}: +${b.count} (${b.costRem} рем., ${b.costMon} мон.)`).join("\n") : "  (ничего)",
    p.blocked.length ? "Ждут условий: " + p.blocked.map(b => `${b.name} (${b.reason})`).join("; ") : "",
    `Потрачено: ${p.spentRem} рем., ${p.spentMon} мон.`, "",
    `Голод: ${p.golod}, Бунт феодалов: ${p.bunt}`,
    p.warnings.length ? "⚠ " + p.warnings.join("\n⚠ ") : ""
  ].filter(x => x !== "").join("\n");
}

function nextTurn() {
  const p = computeTurn(); writeBuildPlan(p.buildings, p.blocked);
  const ui = SpreadsheetApp.getUi();
  if (ui.alert("Превью хода", previewText(p) + "\n\nПрименить ход?", ui.ButtonSet.YES_NO) === ui.Button.YES) { applyTurn(p); ui.alert(`Ход ${p.newTurn} применён.`); }
}

function previewTurn() {
  const p = computeTurn(); writeBuildPlan(p.buildings, p.blocked);
  SpreadsheetApp.getUi().alert("Превью хода", previewText(p), SpreadsheetApp.getUi().ButtonSet.OK);
}

function recalcAll() { SpreadsheetApp.flush(); refreshAll(); SpreadsheetApp.getUi().alert("Формулы пересчитаны, подсказки обновлены."); }

// ============================================================
// ПАНЕЛИ
// ============================================================
function openPlayerPanel() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("PlayerPanel").setTitle("Хроника").setWidth(360)); }
function openAdminPanel() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("AdminPanel").setTitle("Админ").setWidth(400)); }
function openRegionsPanel() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("RegionsPanel").setTitle("Регионы").setWidth(380)); }
function openSettings() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("Settings").setTitle("Настройки").setWidth(300)); }
function openWizard() { ensureOrdersSheet(); SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("Wizard").setTitle("Мастер хода").setWidth(420)); }

function getPlayerSummary() {
  const ss = SS_(); const calc = ss.getSheetByName("Расчёты"); const res = ss.getSheetByName("Ресурсы");
  const cv = calc.getRange(1, 2, 141, 1).getValues(); const g = (row) => cv[row - 1][0];
  const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const rnd = (v, d) => { const k = Math.pow(10, d || 0); return Math.round(num(v) * k) / k; };
  const rv = res.getRange(4, 2, 7, 1).getValues().map(r => num(r[0]));
  const pools = getPools();
  return {
    turn: getCurrentTurn(), sklad: pools.sklad, kazna: pools.kazna,
    stateName: String(ss.getSheetByName("Статистика").getRange("B3").getValue() || ""),
    armyPower: ss.getSheetByName("Армия") ? rnd(ss.getSheetByName("Армия").getRange(ARMY_LAST + 1, 17).getValue()) : 0,
    population: rnd(g(13)), food: rnd(g(23)), rem: rnd(g(26)), gold: rnd(g(31)), upkeep: rnd(g(32)), net: rnd(g(33)), unity: rnd(g(39), 1),
    cleric: rnd(g(105), 2), clericGrowth: rnd(g(103), 2), clericEnd: rnd(g(106), 2), threat: String(g(107) || ""),
    fundRem: pools.fundRem, fundMon: pools.fundMon,
    crises: { "Голод": g(67), "Бунт феодалов": g(68), "Религиозный раскол": g(69), "Поветрие": g(70), "Набеги": g(71), "Опустошение земель": g(72), "Нападение зверей": g(73) },
    resources: { "Золото": rv[0], "Железо": rv[1], "Драг. камни": rv[2], "Уголь": rv[3], "Соль": rv[4], "Благовония": rv[5], "Шёлк": rv[6] },
    armyTotal: rnd(g(112)), events: getActiveEvents(), modifiers: getModifiersForPanel()
  };
}

function getAdminSummary() {
  const p = computeTurn(); writeBuildPlan(p.buildings, p.blocked);
  const r = n => Math.round(Number(n) || 0);
  return { turn: p.newTurn - 1, population: p.population, popGrowth: p.popGrowth, cleric: Math.round(p.cleric * 100) / 100, clericGrowth: p.clericGrowth, clericSpent: p.clericSpent,
    fundRem: r(p.fundRem), fundMon: r(p.fundMon), availRem: r(p.availRem), availMon: r(p.availMon), budgetPct: p.budgetPct, maxPerTurn: p.maxPerTurn,
    sklad: r(p.sklad), kazna: r(p.kazna), newSklad: r(p.newSklad), newKazna: r(p.newKazna), upkeep: r(p.upkeep), costRem: p.costRem, costMon: p.costMon,
    loyalty: p.loyalty, warnings: p.warnings, modifiers: p.modifiers, modMon: r(p.modMon), modRem: r(p.modRem),
    buildings: p.buildings, blocked: p.blocked, spentRem: p.spentRem, spentMon: p.spentMon, golod: p.golod, bunt: p.bunt };
}

// Применение из админ-панели идёт тем же путём, что и Мастер хода (Журнал, приказ, Хроника).
function approveTurnFromPanel() { const res = wizardApplyTurn(); return "Ход " + res.turn + " применён"; }

function rollEventFromPanel() { return rollRandomEvent(); }
function resolveEventFromPanel(rowIdx, choice) { resolveEvent(rowIdx, choice); return "Решение сохранено"; }

// ============================================================
// МАСТЕР ХОДА
// ============================================================
function wizardValidate() {
  const ss = SS_(); const problems = [], ok = [];
  const num = (v) => { if (v === "" || v === null) return null; const n = Number(v); return isNaN(n) ? null : n; };
  const res = ss.getSheetByName("Ресурсы");
  if (res) { const e = res.getRange(4, 2, 7, 1).getValues().filter(r => num(r[0]) === null).length; if (e > 0) problems.push("Ресурсы: " + e + " пустых."); else ok.push("Ресурсы заполнены"); } else problems.push("Нет листа «Ресурсы»");
  const reg = ss.getSheetByName("Регионы");
  if (reg) { const rows = reg.getRange(4, 1, 18, 3).getValues(); const bad = []; let t = 0; rows.forEach(r => { if (!r[0]) return; t++; const pop = num(r[2]); if (pop === null || pop <= 0) bad.push(r[0]); }); if (bad.length > 0) problems.push("Регионы без населения: " + bad.join(", ")); else if (t === 0) problems.push("Регионы: нет ни одного"); else ok.push("Регионы заполнены (" + t + ")"); } else problems.push("Нет листа «Регионы»");
  const bld = ss.getSheetByName("Стройки");
  if (bld) {
    const lastB = parseInt(DOCPROPS_().getProperty("LAST_B_ROW")) || bldLayout().last;
    const over = bld.getRange(BLD_FIRST, 1, lastB - BLD_FIRST + 1, 12).getValues().filter(r => r[1] && num(r[11]) > 0 && (num(r[10]) || 0) > num(r[11])).map(r => r[1]);
    if (over.length > 0) problems.push("Стройки: превышен лимит — " + over.join(", ")); else ok.push("Стройки в норме");
  } else problems.push("Нет листа «Стройки»");
  const evs = ss.getSheetByName("События");
  if (evs) { let active = 0; const last = evs.getLastRow(); if (last >= 4) evs.getRange(4, 6, last - 3, 1).getValues().forEach(row => { if (row[0] === "АКТИВНО") active++; }); if (active > 0) problems.push("События: активных без решения — " + active); else ok.push("Активных событий нет"); }
  const st = ss.getSheetByName("Статистика");
  const mods = readModifiers();
  const badMods = mods.filter(x => x.d[2] === "АКТИВЕН" && x.d[1] === "Временный" && (x.d[3] === "" || isNaN(Number(x.d[3])))).map(x => x.d[0]);
  if (badMods.length) problems.push("Модификаторы: у временных не указано «Ходов осталось» — " + badMods.join(", "));
  else ok.push("Модификаторов активно: " + mods.filter(x => x.d[2] === "АКТИВЕН").length);
  if (st) { const armyWs = ss.getSheetByName("Армия"); const badArmy = (armyWs ? armyWs.getRange(ARMY_FIRST, 3, ARMY_LAST - ARMY_FIRST + 1, 5).getValues() : []).filter(r => (num(r[4]) || 0) > 0 && !r[1]).length; if (badArmy > 0) problems.push("Армия: " + badArmy + " отрядов без рода войск"); else ok.push("Армия в норме"); }
  return { problems, ok };
}

function wizardPreview() {
  try {
    const p = computeTurn(); writeBuildPlan(p.buildings, p.blocked);
    const out = { success: true, turn: p.newTurn };
    ["population","newPopulation","popGrowth","popPct","cleric","clericSpent","newCleric","clericGrowth","fundRem","fundMon","fundInRem","fundInMon","availRem","availMon","budgetPct","maxPerTurn",
     "sklad","kazna","storeInRem","storeInMon","upkeep","costRem","costMon","newSklad","newKazna","loyalty","warnings","modMon","modRem","modifiers","buildings","blocked","spentRem","spentMon","golod","bunt"].forEach(k => out[k] = p[k]);
    return out;
  } catch (e) { return { success: false, error: e.message }; }
}

function wizardGetNextTurn() { return getCurrentTurn() + 1; }

// Данные для шага 2 Мастера: номер хода, текущие расходы хода и остатки.
function wizardGetStep2() {
  const c = getTurnCosts(); const p = getPools();
  return { turn: getCurrentTurn() + 1, rem: c.rem, mon: c.mon, cleric: c.cleric, sklad: p.sklad, kazna: p.kazna };
}

// Номер хода определяется на сервере (следующий за последним применённым), а не берётся из панели.
// Повторное сохранение на том же шаге обновляет строку, а не плодит дубли.
// costs = { rem, mon, cleric } — расходы по вердикту: пишутся в поля ввода и учитываются в превью/ходе.
function wizardSaveOrder(turn, orderText, verdictText, costs) {
  const ss = SS_();
  const ws = ensureOrdersSheet();
  turn = getCurrentTurn() + 1;
  orderText = String(orderText || "").trim(); verdictText = String(verdictText || "").trim();
  if (costs) {
    const pos = x => Math.max(0, Number(x) || 0);
    const calc = ss.getSheetByName("Расчёты");
    if (calc) { calc.getRange("B143:B144").setValues([[pos(costs.rem)], [pos(costs.mon)]]); calc.getRange("B104").setValue(pos(costs.cleric)); }
  }
  const c = getTurnCosts();
  let row = ws.getLastRow() + 1;
  if (ws.getLastRow() >= 4) {
    const last = ws.getRange(ws.getLastRow(), 1, 1, 4).getValues()[0];
    if (Number(last[0]) === turn && last[3] === "ожидает") row = ws.getLastRow();
  }
  if (row < 4) row = 4;
  ws.getRange(row, 1).setValue(turn);
  const put = (col, text, label) => {
    const cell = ws.getRange(row, col);
    if (/^https?:\/\//i.test(text)) {
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(text).build());
    } else {
      cell.setNumberFormat("@").setValue(text).setWrap(true).setFontWeight("normal");
    }
  };
  put(2, orderText, "📜 Открыть полный текст приказа");
  put(3, verdictText, "⚖️ Открыть полный вердикт");
  ws.getRange(row, 4).setValue("ожидает");
  ws.getRange(row, 5).setValue([[c.rem, "склад"], [c.mon, "казна"], [c.cleric, "клирика"]].filter(x => x[0]).map(x => x[1] + " −" + x[0]).join(" · ") || "—");
  ws.getRange(row, 1, 1, 5).setBorder(true,true,true,true,true,true,C.brown,SpreadsheetApp.BorderStyle.SOLID);
  try { refreshNotes(); } catch (e) {}
  return "Приказ на ход " + turn + " сохранён";
}

function wizardApplyTurn() {
  const p = computeTurn(); applyTurn(p);
  const orders = SS_().getSheetByName("Приказы");
  if (orders && orders.getLastRow() >= 4) {
    const lr = orders.getLastRow(); const row = orders.getRange(lr, 1, 1, 4).getValues()[0];
    if (Number(row[0]) === p.newTurn && row[3] === "ожидает") orders.getRange(lr, 4).setValue("применён");
  }
  try { writeChronicle(1200 + p.newTurn, p.newTurn, "Ход " + p.newTurn, "Население: " + p.newPopulation + ". Построено: " + (p.buildings.map(b => b.name + (b.count > 1 ? " ×" + b.count : "")).join(", ") || "—") + ". Казна: " + Math.round(p.newKazna) + ", склад: " + Math.round(p.newSklad) + ". Голод: " + p.golod + ". Бунт: " + p.bunt + "."); } catch(e) {}
  return { turn: p.newTurn, population: p.newPopulation, kazna: Math.round(p.newKazna), sklad: Math.round(p.newSklad), popGrowth: p.popGrowth, clericGrowth: p.clericGrowth, buildings: p.buildings, spentRem: p.spentRem, spentMon: p.spentMon, golod: p.golod, bunt: p.bunt };
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (События, Регионы, Хроника, Приказы, Расы)
// ============================================================
function ensureChronicleSheet() {
  const ss = SS_();
  let ws = ss.getSheetByName("Хроника");
  if (ws) return ws;
  ws = ss.insertSheet("Хроника");
  ws.setHiddenGridlines(true);
  [90, 120, 270, 640].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  sheetTitle(ws, 4, "Летопись", '="ЗАПИСЕЙ: "&COUNTA(C4:C3000)');
  styleOrnament(ws, 2);
  ["ГОД", "МЕТКА", "СОБЫТИЕ", "ЗАПИСЬ ЛЕТОПИСЦА"].forEach((h, i) => ws.getRange(3, i + 1).setValue(h)); styleHeaderRow(ws, 3, 1, 4);
  ws.getRange(3, 3, 1, 2).setHorizontalAlignment("left");
  const all = (c, k) => ws.getRange(4, c, 2997, k || 1);
  all(1, 4).setVerticalAlignment("middle").setFontFamily(FONT_BODY).setFontColor(C.text).setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  all(1).setFontFamily(FONT_TITLE).setFontSize(16).setFontColor(C.gold).setHorizontalAlignment("center");
  all(2).setFontFamily(FONT_TITLE).setFontSize(8).setFontWeight("bold").setHorizontalAlignment("center");
  all(3).setFontSize(12).setFontWeight("bold").setWrap(true);
  all(4).setFontSize(12).setFontStyle("italic").setWrap(true).setFontColor("#D8CBAE");
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$A4=$A3").setFontColor(C.muted).setRanges([all(1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("ХОД").setBackground("#2A2213").setFontColor(C.gold).setRanges([all(2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("СОБЫТИЕ").setBackground(C.input).setFontColor("#C9A646").setRanges([all(2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("РЕШЕНИЕ").setBackground(C.greenBg).setFontColor(C.green).setRanges([all(2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ЭФФЕКТ").setBackground("#2A1A30").setFontColor("#B9A3E3").setRanges([all(2)]).build()]);
  paintParchment(ws, 200, 4);
  return ws;
}

// Запись летописи. Метка: «ХОД n» — итог хода, «ЭФФЕКТ» — завершение/истечение модификатора, «РЕШЕНИЕ», иначе «СОБЫТИЕ».
function writeChronicle(year, turn, event, text) {
  const ws = ensureChronicleSheet(); const row = Math.max(4, ws.getLastRow() + 1);
  const ev = String(event || ""), tx = String(text || "");
  const tag = /^Ход \d+/.test(ev) ? "ХОД " + turn : /^(Завершено|Истёк срок):/.test(ev) ? "ЭФФЕКТ" : /^Решение:/.test(tx) ? "РЕШЕНИЕ" : "СОБЫТИЕ";
  ws.getRange(row, 1, 1, 4).setValues([[year, tag, ev, tx]]);
}

function ensureEventsSheet() {
  const ss = SS_();
  let ws = ss.getSheetByName("События");
  if (ws) return ws;
  ws = ss.insertSheet("События");
  ws.setHiddenGridlines(true);
  [56, 70, 230, 420, 300, 170].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  sheetTitle(ws, 6, "События", '="ЖДУТ РЕШЕНИЯ: "&COUNTIF(F4:F2000,"АКТИВНО")', 2);
  styleOrnament(ws, 2);
  ["ХОД", "", "СОБЫТИЕ", "ОПИСАНИЕ", "ВАРИАНТЫ", "СТАТУС"].forEach((h, i) => ws.getRange(3, i + 1).setValue(h)); styleHeaderRow(ws, 3, 1, 6);
  const all = (c, k) => ws.getRange(4, c, 1997, k || 1);
  all(1, 6).setVerticalAlignment("middle").setFontFamily(FONT_BODY).setFontColor(C.text).setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  all(1).setFontFamily(FONT_TITLE).setFontSize(14).setFontColor(C.gold).setHorizontalAlignment("center");
  all(2).setHorizontalAlignment("center");
  all(3).setFontFamily(FONT_TITLE).setFontSize(14).setFontWeight("bold").setFontColor(C.gold).setWrap(true);
  all(4).setFontSize(12).setFontStyle("italic").setWrap(true);
  all(5).setFontSize(11).setWrap(true);
  all(6).setFontFamily(FONT_TITLE).setFontSize(9).setFontWeight("bold").setHorizontalAlignment("center").setWrap(true);
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("АКТИВНО").setBackground("#2A2213").setFontColor(C.gold).setRanges([all(6)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("РЕШЕНО").setBackground(C.greenBg).setFontColor(C.green).setRanges([all(6)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=($F4<>"АКТИВНО")*($F4<>"")>0').setFontColor(C.muted).setRanges([all(1, 5)]).build()]);
  paintParchment(ws, 100, 6);
  return ws;
}

function ensureOrdersSheet() {
  const ss = SS_();
  let ws = ss.getSheetByName("Приказы"); if (ws) return ws;
  ws = ss.insertSheet("Приказы"); ws.setHiddenGridlines(true);
  [60, 430, 430, 120, 240].forEach((w, i) => ws.setColumnWidth(i + 1, w));
  sheetTitle(ws, 5, "Приказы и вердикты", '="ОЖИДАЕТ: "&COUNTIF(D4:D2000,"ожидает")');
  styleOrnament(ws, 2);
  ["ХОД", "ПРИКАЗ ИГРОКА", "ВЕРДИКТ АДМИНА", "СТАТУС", "РАСХОДЫ ХОДА"].forEach((h, i) => ws.getRange(3, i + 1).setValue(h)); styleHeaderRow(ws, 3, 1, 5);
  ws.getRange(3, 2, 1, 2).setHorizontalAlignment("left");
  const all = (c, k) => ws.getRange(4, c, 1997, k || 1);
  all(1, 5).setVerticalAlignment("top").setFontFamily(FONT_BODY).setFontSize(12).setFontColor(C.text).setBorder(null, null, null, null, false, true, C.brown, SpreadsheetApp.BorderStyle.SOLID);
  all(1).setFontFamily(FONT_TITLE).setFontSize(16).setFontColor(C.muted).setHorizontalAlignment("center");
  all(2, 2).setWrap(true); all(3).setFontStyle("italic");
  all(4).setFontFamily(FONT_TITLE).setFontSize(9).setFontWeight("bold").setHorizontalAlignment("center");
  all(5).setFontSize(11).setFontColor(C.muted).setWrap(true);
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ожидает").setBackground("#2A2213").setFontColor(C.gold).setRanges([all(4)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("применён").setBackground(C.greenBg).setFontColor(C.green).setRanges([all(4)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D4="ожидает"').setBackground(C.input).setRanges([all(1, 3), all(5)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D4="ожидает"').setFontColor(C.gold).setRanges([all(1)]).build()]);
  paintParchment(ws, 100, 5);
  return ws;
}

function rollRandomEvent() {
  const idx = Math.floor(Math.random() * EVENTS_CATALOG.length); const e = EVENTS_CATALOG[idx];
  const ws = ensureEventsSheet();
  const curTurn = getCurrentTurn() + 1;                 // событие относится к ходу, который сейчас играется
  const row = Math.max(4, ws.getLastRow() + 1);
  ws.getRange(row, 1, 1, 6).setValues([[curTurn, e[0], e[1], e[2], e[3].map((v, i) => `${i + 1}. ${v}`).join("\n"), "АКТИВНО"]]);
  ws.getRange(row, 2).setFontSize(30);                  // активное событие — крупная «карточка»
  ws.setRowHeight(row, 76);
  writeChronicle(1200 + curTurn, curTurn, e[1], e[2]);
  return { row, art: e[0], name: e[1], description: e[2], variants: e[3], options: e[3] };
}

function parseVariants(text) { return String(text || "").split("\n").map(x => x.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean); }

// Номер строки берётся ДО фильтрации — иначе решение записывалось в чужую строку.
function getActiveEvents() {
  const ws = ensureEventsSheet(); const last = ws.getLastRow(); if (last < 4) return [];
  const out = [];
  ws.getRange(4, 1, last - 3, 6).getValues().forEach((r, i) => {
    if (r[5] !== "АКТИВНО") return;
    out.push({ row: i + 4, turn: r[0], art: r[1], name: r[2], description: r[3], variants: r[4], options: parseVariants(r[4]) });
  });
  return out;
}

function resolveEvent(rowIdx, choice) {
  const ws = ensureEventsSheet(); rowIdx = Number(rowIdx);
  if (!(rowIdx >= 4 && rowIdx <= ws.getLastRow())) throw new Error("Событие не найдено");
  const r = ws.getRange(rowIdx, 1, 1, 6).getValues()[0];
  if (r[5] !== "АКТИВНО") throw new Error("Событие «" + r[2] + "» уже решено");
  const opts = parseVariants(r[4]); const k = Number(choice) - 1;
  const label = opts[k] ? (k + 1) + ". " + opts[k] : String(choice);
  ws.getRange(rowIdx, 6).setValue("РЕШЕНО: " + label);
  ws.getRange(rowIdx, 2).setFontSize(16); ws.setRowHeight(rowIdx, 34);   // решённое — компактная строка
  const turn = Number(r[0]) || (getCurrentTurn() + 1);
  writeChronicle(1200 + turn, turn, r[2], "Решение: " + label);
}

function rollEventFromMenu() { const e = rollRandomEvent(); SpreadsheetApp.getUi().alert(e.art + "  " + e.name + "\n\n" + e.description + "\n\n" + e.variants.map((v, i) => (i + 1) + ". " + v).join("\n") + "\n\nЗагляни в лист «События», чтобы записать решение."); }
function showActiveEvents() { const evs = getActiveEvents(); if (evs.length === 0) { SpreadsheetApp.getUi().alert("Активных событий нет."); return; } SpreadsheetApp.getUi().alert(evs.map(e => e.art + "  " + e.name + "\n" + e.description + "\nВарианты:\n" + e.variants).join("\n\n———\n\n")); }
// Прирост населения по регионам: одно чтение блока A4:H21 и по одной записи на регион (а не по ячейке) — ход быстрее.
function distributePopGrowthToRegions(reg, growth) { growth = Math.round(Number(growth) || 0); if (growth === 0) return; const FIRST = 4, LAST = 21; const block = reg.getRange(FIRST, 1, LAST - FIRST + 1, 8).getValues(); const regions = []; let grandTotal = 0; block.forEach((row, i) => { if (!row[0]) return; const pop = row.slice(3, 8).map(v => Math.max(0, Math.round(Number(v) || 0))); const total = pop.reduce((a, b) => a + b, 0); if (total <= 0) return; regions.push({ row: FIRST + i, pop, total }); grandTotal += total; }); if (grandTotal === 0 || regions.length === 0) return; const regionShares = distributeByLargestRemainder(regions.map(x => x.total), grandTotal, growth); regions.forEach((region, i) => { const regionGrowth = regionShares[i]; if (regionGrowth === 0) return; const estateShares = distributeByLargestRemainder(region.pop, region.total, regionGrowth); reg.getRange(region.row, 4, 1, 5).setValues([region.pop.map((v, j) => Math.max(0, v + estateShares[j]))]); }); }
function distributeByLargestRemainder(weights, totalWeight, amount) { const n = weights.length; if (n === 0 || totalWeight === 0 || amount === 0) return new Array(n).fill(0); const sign = amount < 0 ? -1 : 1; const abs = Math.abs(amount); const raw = weights.map(w => abs * w / totalWeight); const floors = raw.map(x => Math.floor(x)); const used = floors.reduce((a, b) => a + b, 0); let remainder = abs - used; const idx = raw.map((x, i) => ({ i, frac: x - Math.floor(x), w: weights[i] })).sort((a, b) => (b.frac - a.frac) || (b.w - a.w)); const result = floors.slice(); for (let k = 0; k < remainder; k++) { result[idx[k % n].i] += 1; } return result.map(x => x * sign); }
function getRegionsForPanel() {
  const ws = ensureRegionsSheet();
  const num = (x) => { const n = Number(x); return isNaN(n) ? 0 : n; };
  const out = [];
  ws.getRange(4, 1, 18, 18).getValues().forEach((d, i) => {
    if (!d[0]) return;
    out.push({ row: 4 + i, name: String(d[0]), type: d[1] || "—", population: Math.round(num(d[2])),
      estates: { "Крестьяне": num(d[3]), "Ремесленники": num(d[4]), "Торговцы": num(d[5]), "Священники": num(d[6]), "Феодалы": num(d[7]) },
      loyalty: { "Крестьяне": Math.round(num(d[8])), "Ремесленники": Math.round(num(d[9])), "Торговцы": Math.round(num(d[10])), "Священники": Math.round(num(d[11])), "Феодалы": Math.round(num(d[12])) },
      avgLoyalty: Math.round(num(d[13])), food: Math.round(num(d[14])), rem: Math.round(num(d[15])), gold: Math.round(num(d[16])), buildings: String(d[17] || "") });
  });
  return out;
}

function addRegionFromPanel(name, type) { const ws = ensureRegionsSheet(); for (let r = 4; r <= 21; r++) { if (!ws.getRange(r, 1).getValue()) { ws.getRange(r, 1).setValue(name).setFontWeight("bold").setFontFamily(FONT_BODY); ws.getRange(r, 2).setValue(type || "Город").setHorizontalAlignment("center"); ws.getRange(r, 3).setFormula(F(`=IF(COUNT(D${r}:H${r})>0,SUM(D${r}:H${r}),"")`)); ws.getRange(r, 14).setFormula(F(`=IF(SUM(D${r}:H${r})>0,(D${r}*I${r}+E${r}*J${r}+F${r}*K${r}+G${r}*L${r}+H${r}*M${r})/SUM(D${r}:H${r}),"")`)).setNumberFormat('0"%"'); for (let c = 3; c <= 13; c++) { if (c >= 9) ws.getRange(r, c).setValue(50).setHorizontalAlignment("center"); else if (c >= 4) ws.getRange(r, c).setValue(0).setHorizontalAlignment("center"); } ws.getRange(r, 15).setFormula(F(`=IF(D${r}>0,D${r}*2*(1+'Расчёты'!$B$52)*(1+'Расчёты'!$C$201)*'Расчёты'!$B$79,0)`)); ws.getRange(r, 16).setFormula(F(`=IF(E${r}>0,E${r}/10*(1+'Расчёты'!$B$51)*(1+'Расчёты'!$C$202)*'Расчёты'!$B$80,0)`)); ws.getRange(r, 17).setFormula(F(`=IF(F${r}>0,F${r}*(1+'Расчёты'!$B$54)*(1+'Расчёты'!$C$203)*'Расчёты'!$B$81,0)`)); ws.getRange(r, 18).setValue("").setWrap(true).setFontFamily(FONT_BODY); return "Регион «" + name + "» добавлен в строку " + r; } } return "Свободных строк нет."; }
function removeRegionFromPanel(row) { const ws = ensureRegionsSheet(); if (row < 4 || row > 21) return "Неверная строка"; const name = ws.getRange(row, 1).getValue(); for (let c = 1; c <= 18; c++) { if (c === 14 || c === 15 || c === 16 || c === 17 || c === 3) continue; ws.getRange(row, c).clearContent(); } return "Регион «" + name + "» удалён"; }
// Пересобирает оформление и формулы листа «Регионы», сохраняя данные. Лист НЕ удаляется:
// удаление ломало все ссылки на него из «Расчётов» (#REF!).
function resetAndRebuildRegions() {
  const ss = SS_(); const ui = SpreadsheetApp.getUi();
  if (ui.alert("Пересоздать лист «Регионы»?", "Названия, сословия, лояльность и постройки сохранятся.", ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const old = ss.getSheetByName("Регионы");
  const data = old ? old.getRange(4, 1, 18, 18).getValues().filter(r => r[0]) : [];
  const ws = ensureRegionsSheet(true);
  if (data.length) {
    ws.getRange(4, 1, 1, 2).clearContent(); ws.getRange(4, 4, 1, 10).clearContent(); ws.getRange(4, 18).clearContent();
    data.forEach((d, i) => {
      const r = 4 + i;
      ws.getRange(r, 1, 1, 2).setValues([[d[0], d[1] || "Город"]]);
      ws.getRange(r, 4, 1, 5).setValues([[d[3], d[4], d[5], d[6], d[7]].map(x => Number(x) || 0)]);
      ws.getRange(r, 9, 1, 5).setValues([[d[8], d[9], d[10], d[11], d[12]].map(x => (x === "" || isNaN(Number(x))) ? 50 : Number(x))]);
      ws.getRange(r, 18).setValue(d[17] || "");
    });
  }
  ui.alert("Готово!");
}

function upgradeToRegionalModel() { const ss = SS_(); const reg = ss.getSheetByName("Регионы"); const calc = ss.getSheetByName("Расчёты"); const ui = SpreadsheetApp.getUi(); if (!reg || !calc) { ui.alert("Нужны листы «Регионы» и «Расчёты»."); return; } const ok = ui.alert("Перейти на региональную модель?", "Регионы будут считать еду/ремесло/казну.", ui.ButtonSet.YES_NO); if (ok !== ui.Button.YES) return; for (let r = 4; r <= 21; r++) { reg.getRange(r, 3).setFormula(F(`=IF(COUNT(D${r}:H${r})>0,SUM(D${r}:H${r}),"")`)); reg.getRange(r, 14).setFormula(F(`=IF(SUM(D${r}:H${r})>0,(D${r}*I${r}+E${r}*J${r}+F${r}*K${r}+G${r}*L${r}+H${r}*M${r})/SUM(D${r}:H${r}),"")`)).setNumberFormat('0"%"'); reg.getRange(r, 15).setFormula(F(`=IF(D${r}>0,D${r}*2*(1+'Расчёты'!$B$52)*(1+'Расчёты'!$C$201)*'Расчёты'!$B$79,0)`)); reg.getRange(r, 16).setFormula(F(`=IF(E${r}>0,E${r}/10*(1+'Расчёты'!$B$51)*(1+'Расчёты'!$C$202)*'Расчёты'!$B$80,0)`)); reg.getRange(r, 17).setFormula(F(`=IF(F${r}>0,F${r}*(1+'Расчёты'!$B$54)*(1+'Расчёты'!$C$203)*'Расчёты'!$B$81,0)`)); } reg.getRange(23, 3).setFormula(F("=SUM(C4:C21)")); reg.getRange(23, 14).setFormula(F("=IF(C23>0,(D23*I23+E23*J23+F23*K23+G23*L23+H23*M23)/C23,0)")).setNumberFormat('0"%"'); reg.getRange(23, 15).setFormula(F("=SUM(O4:O21)")); reg.getRange(23, 16).setFormula(F("=SUM(P4:P21)")); reg.getRange(23, 17).setFormula(F("=SUM(Q4:Q21)")); calc.getRange(14, 2).setFormula(F("=SUM('Регионы'!D4:D21)")); calc.getRange(15, 2).setFormula(F("=SUM('Регионы'!E4:E21)")); calc.getRange(16, 2).setFormula(F("=SUM('Регионы'!F4:F21)")); calc.getRange(17, 2).setFormula(F("=SUM('Регионы'!G4:G21)")); calc.getRange(18, 2).setFormula(F("=SUM('Регионы'!H4:H21)")); calc.getRange(13, 2).setFormula(F("=SUM(B14:B18)")); calc.getRange(21, 2).setFormula(F("=(SUM('Регионы'!O4:O21)+B201*B79)*(1+B126)")); calc.getRange(26, 2).setFormula(F("=(SUM('Регионы'!P4:P21)+B202*B80)*(1+B127)")); calc.getRange(29, 2).setFormula(F("=SUM('Регионы'!Q4:Q21)+B203*B81")); ui.alert("Готово! Обнови таблицу (F5)."); }
// Экспорт сохраняет ФОРМУЛЫ (а не только их значения), иначе после импорта таблица перестаёт считать.
// Текст, начинающийся с = + - @, экранируется апострофом, чтобы при импорте не стать формулой.
function exportGame() {
  const ss = SS_(); const ui = SpreadsheetApp.getUi();
  const data = { version: 2, timestamp: new Date().toISOString(), sheets: {} };
  ["Статистика","Армия","Ресурсы","Пантеон","Журнал","Стройки","Расчёты","Регионы","Модификаторы","Хроника","События","Приказы","Расы","Расы_Контент"].forEach(name => {
    const ws = ss.getSheetByName(name); if (!ws) return;
    const lastRow = ws.getLastRow(); const lastCol = ws.getLastColumn();
    if (lastRow === 0 || lastCol === 0) { data.sheets[name] = []; return; }
    const rng = ws.getRange(1, 1, lastRow, lastCol); const values = rng.getValues(); const formulas = rng.getFormulas();
    data.sheets[name] = values.map((row, i) => row.map((v, j) => formulas[i][j] ? formulas[i][j] : ((typeof v === "string" && /^[=+\-@]/.test(v)) ? "'" + v : v)));
  });
  const file = DriveApp.createFile("chronicle_backup_" + Date.now() + ".json", JSON.stringify(data), "application/json");
  ui.alert("Экспорт готов!\n\nФайл: " + file.getName() + "\nСсылка: " + file.getUrl());
}

function importGame() { SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile("ImportDialog").setWidth(400).setHeight(200), "Импорт состояния"); }
function importGameFromJson(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { throw new Error("Это не JSON экспорта: " + e.message); }
  if (!data || !data.sheets) throw new Error("В JSON нет раздела sheets");
  if ((data.version || 1) < 2) throw new Error("Файл старого формата (v1) содержит только значения без формул — импорт сломал бы расчёты. Сделайте новый экспорт.");
  const ss = SS_(); let n = 0;
  Object.keys(data.sheets).forEach(name => {
    const values = data.sheets[name]; if (!Array.isArray(values) || values.length === 0) return;
    const ws = ss.getSheetByName(name) || ss.insertSheet(name);
    const width = Math.max.apply(null, values.map(r => r.length));
    const grid = values.map(r => { const row = r.slice(); while (row.length < width) row.push(""); return row; });
    ws.getRange(1, 1, ws.getMaxRows(), ws.getMaxColumns()).clearContent();
    ws.getRange(1, 1, grid.length, width).setValues(grid);
    n++;
  });
  try { SpreadsheetApp.flush(); refreshAll(); } catch (e) {}
  return "Импорт завершён: листов " + n;
}

function dailyReminderCheck() { const props = DOCPROPS_(); const last = props.getProperty("LAST_TURN_DATE"); if (!last) { props.setProperty("LAST_TURN_DATE", new Date().toISOString()); return; } const days = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24); if (days < 14) return; const owner = Session.getEffectiveUser().getEmail(); const ss = SS_(); MailApp.sendEmail({ to: owner, subject: "Хроника: пора сделать ход", body: "Прошло " + Math.floor(days) + " дней с последнего хода.\n\nОткрыть: " + ss.getUrl() }); props.setProperty("LAST_TURN_DATE", new Date().toISOString()); }
function monthlyBackup() {
  const ss = SS_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const folderName = "Хроника_Бэкапы"; const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  DriveApp.getFileById(ss.getId()).makeCopy("Backup_Хроника_" + stamp, folder);
}

function setupTriggers() { SpreadsheetApp.getUi().alert("Триггеры:\n\n1. Открой иконку «Триггеры» (часы) слева.\n2. «+ Добавить триггер».\n3. dailyReminderCheck, По времени, День, 12:00–13:00.\n4. monthlyBackup, По времени, Месяц, 1-е, 3:00–4:00."); }
function protectGame() { const ss = SS_(); const ui = SpreadsheetApp.getUi(); if (ui.alert("Защитить листы от изменений?", "Игрок сможет только смотреть.", ui.ButtonSet.YES_NO) !== ui.Button.YES) return; const list = ["Армия", "Расчёты", "Стройки", "Журнал", "Ресурсы", "Пантеон", "Хроника", "События", "Приказы", "Регионы", "Модификаторы", "Расы", "Расы_Контент"]; let count = 0; list.forEach(name => { const ws = ss.getSheetByName(name); if (!ws) return; ws.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove()); const p = ws.protect().setDescription("Защита от игрока"); p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false); p.addEditor(Session.getEffectiveUser()); count++; }); ui.alert("Защищено: " + count); }
function unprotectGame() { const ss = SS_(); const ui = SpreadsheetApp.getUi(); let count = 0; ss.getSheets().forEach(ws => { ws.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => { p.remove(); count++; }); }); ui.alert("Снято: " + count); }
function fixAllFormulas() { const ss = SS_(); const ui = SpreadsheetApp.getUi(); let count = 0, skipped = 0; ss.getSheets().forEach(sheet => { const lastRow = sheet.getLastRow(); const lastCol = sheet.getLastColumn(); if (lastRow === 0 || lastCol === 0) return; const range = sheet.getRange(1, 1, lastRow, lastCol); const formulas = range.getFormulas(); for (let r = 0; r < formulas.length; r++) { for (let c = 0; c < formulas[r].length; c++) { const f = formulas[r][c]; if (!f || !f.startsWith("=")) continue; let newF = f.replace(/^=\s*/, "="); newF = newF.replace(/\.(\d)/g, "§$1"); newF = newF.replace(/,/g, ";"); newF = newF.replace(/§/g, ","); newF = "= " + newF.substring(1); if (newF !== f) { range.getCell(r + 1, c + 1).setFormula(newF); count++; } else skipped++; } } }); ui.alert("Обновлено: " + count + "\nУже правильных: " + skipped); }