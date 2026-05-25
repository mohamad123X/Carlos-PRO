const { Client, GatewayIntentBits } = require('discord.js');
const botsConfig = require('./bots_config.json');

// تأخير لتجنب الحظر من ديسكورد عند تشغيل 100 بوت في نفس اللحظة
const delay = ms => new Promise(res => setTimeout(res, ms));

async function startSwarm() {
    console.log("🚀 جاري تهيئة جيش البوتات...");

    for (const botData of botsConfig) {
        // جلب التوكن الخاص بالبوت من متغيرات البيئة في Railway
        const token = process.env[botData.tokenVar];
        
        if (!token) {
            console.log(`⚠️ تم تخطي البوت ${botData.name} (لا يوجد توكن ${botData.tokenVar})`);
            continue;
        }

        const client = new Client({
            intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds]
        });

        // تعيين المنطق البرمجي (المهام) لكل بوت
        client.on('messageCreate', async (message) => {
            if (message.author.bot) return;

            const content = message.content;

            switch (botData.task) {
                case 'laugh':
                    // مهمة الضحك: إذا كانت الرسالة تحتوي على إيموجي ضحك أو 3 هاءات متتالية
                    if (content.includes('😂') || content.includes('🤣') || /ه{3,}/.test(content)) {
                        await message.react('😂');
                        await message.reply('هههههههههههههههههههههه والله ضحكتني!');
                    }
                    break;

                case 'link_guard':
                    // مهمة الحراسة: فضح الروابط وتنبيه المستخدمين
                    if (content.includes('http://') || content.includes('https://')) {
                        await message.reply(`⚠️ **انتباه!** المستخدم ${message.author} أرسل رابطاً. يرجى توخي الحذر وعدم الضغط إذا كان غير موثوق.`);
                    }
                    break;

                case 'sad_react':
                    // مهمة التفاعل الحزين
                    if (content.includes('حزين') || content.includes('سيء') || content.includes('😭')) {
                        await message.react('😢');
                        await message.reply('لا تحزن، كل شيء سيكون على ما يرام بإذن الله.');
                    }
                    break;

                case 'invite_guard':
                    // حارس الدعوات: تنبيه عند إرسال رابط سيرفر ديسكورد
                    if (content.includes('discord.gg/') || content.includes('discord.com/invite/')) {
                        await message.delete().catch(() => {});
                        await message.channel.send(`🚫 يمنع نشر دعوات السيرفرات هنا يا ${message.author}!`);
                    }
                    break;

                // يمكنك إضافة باقي المهام هنا بوضوح وسهولة
            }
        });

        client.once('ready', () => {
            console.log(`✅ البوت [${botData.name}] متصل الآن بمهمة: ${botData.task}`);
        });

        // تسجيل الدخول مع معالجة الأخطاء
        client.login(token).catch(err => console.error(`❌ خطأ في تشغيل ${botData.name}:`, err.message));
        
        // ننتظر 3 ثواني قبل تشغيل البوت التالي لتجنب Rate Limits
        await delay(3000);
    }
}

// بدء التشغيل
startSwarm();
