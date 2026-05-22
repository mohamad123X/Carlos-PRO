const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    REST, 
    Routes 
} = require('discord.js');
const mineflayer = require('mineflayer');

// 1. إعداد صلاحيات بوت الديسكورد
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// متغير مؤقت لتخزين بيانات الجلسة الحالية أثناء الإعداد
const userSessions = new Map();

// توكن الديسكورد من متغيرات البيئة للأمان
const TOKEN = process.env.DISCORD_TOKEN;

// 2. تسجيل أمر السلاش الخاص بالتشغيل (/spawn)
client.on('ready', async () => {
    console.log(`🔥 تم تشغيل بوت الديسكورد بنجاح باسم: ${client.user.tag}`);
    
    const commands = [
        {
            name: 'spawn',
            description: 'إدخال بوت لاعب إلى سيرفر ماين كرافت الخاص بك',
        }
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('⏳ جاري تسجيل أوامر السلاش...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل أوامر السلاش بنجاح!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
});

// 3. التعامل مع التفاعلات (الأوامر، القوائم، الأزرار، النوافذ)
client.on('interactionCreate', async interaction => {
    
    // أولاً: التعامل مع أمر السلاش /spawn
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'spawn') {
            // إنشاء القائمة المنسدلة للإصدارات (بسبب حد ديسكورد 25 خياراً، نضع أبرز الإصدارات المطلوبة)
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_version')
                .setPlaceholder('اختر إصدار سيرفر ماين كرافت...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('1.8.9').setValue('1.8.9'),
                    new StringSelectMenuOptionBuilder().setLabel('1.12.2').setValue('1.12.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.16.5').setValue('1.16.5'),
                    new StringSelectMenuOptionBuilder().setLabel('1.18.2').setValue('1.18.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.19.4').setValue('1.19.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.4').setValue('1.20.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.21').setValue('1.21'),
                    new StringSelectMenuOptionBuilder().setLabel('1.26.2 (الأحدث)').setValue('1.26.2')
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({ content: '⚙️ الخطوة 1: يرجى اختيار إصدار السيرفر من القائمة أدناه:', components: [row], ephemeral: true });
        }
    }

    // ثانياً: استقبال اختيار الإصدار وتوليد زر فتح النافذة المنبثقة
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_version') {
            const selectedVersion = interaction.values[0];
            
            // حفظ الإصدار المختار في جلسة المستخدم مؤقتاً
            userSessions.set(interaction.user.id, { version: selectedVersion });

            const button = new ButtonBuilder()
                .setCustomId('open_modal')
                .setLabel('اضغط لملء بيانات السيرفر')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);
            await interaction.update({ content: `✅ تم اختيار الإصدار: **${selectedVersion}**\nالآن اضغط على الزر أدناه لإدخال تفاصيل السيرفر:`, components: [row] });
        }
    }

    // ثالثاً: فتح النافذة المنبثقة (Modal) عند الضغط على الزر
    if (interaction.isButton()) {
        if (interaction.customId === 'open_modal') {
            const modal = new ModalBuilder()
                .setCustomId('bot_details_modal')
                .setTitle('بيانات دخول بوت ماين كرافت');

            const ipInput = new TextInputBuilder().setCustomId('mc_ip').setLabel('عنوان السيرفر (IP)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('مثال: my-server.magmanode.net');
            const portInput = new TextInputBuilder().setCustomId('mc_port').setLabel('البورت (Port) - اتركه فارغاً للافتراضي').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('25565');
            const usernameInput = new TextInputBuilder().setCustomId('mc_username').setLabel('اسم لاعب البوت (Username)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Aternot_Bot');
            const commandsInput = new TextInputBuilder().setCustomId('mc_commands').setLabel('أوامر/رسائل الدخول (سطر لكل أمر)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('/login mypassword\n/register mypassword\nمرحباً بالجميع سأبقى هنا!');

            modal.addComponents(
                new ActionRowBuilder().addComponents(ipInput),
                new ActionRowBuilder().addComponents(portInput),
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(commandsInput)
            );

            await interaction.showModal(modal);
        }
    }

    // رابعاً: معالجة البيانات المدخلة وتشغيل بوت ماين كرافت (Mineflayer)
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'bot_details_modal') {
            await interaction.deferReply({ ephemeral: true });

            const ip = interaction.fields.getTextInputValue('mc_ip');
            const portStr = interaction.fields.getTextInputValue('mc_port');
            const port = portStr ? parseInt(portStr) : 25565;
            const username = interaction.fields.getTextInputValue('mc_username');
            const commandsText = interaction.fields.getTextInputValue('mc_commands');

            // جلب الإصدار المحفوظ سابقاً للجلسة
            const session = userSessions.get(interaction.user.id);
            const version = session ? session.version : '1.20.4';

            await interaction.followup({ content: `🚀 جاري تشغيل البوت **${username}** ومحاولة الدخول إلى \`${ip}:${port}\` بإصدار \`${version}\`...` });

            // استدعاء محرك Mineflayer لإنشاء اللاعب الوهمي وإدخاله السيرفر
            createMinecraftBot(ip, port, username, version, commandsText, interaction);
        }
    }
});

// 4. دالة تشغيل بوت ماين كرافت وإرسال الأوامر والرسائل
function createMinecraftBot(host, port, username, version, commandsText, interaction) {
    const mcBot = mineflayer.createBot({
        host: host,
        port: port,
        username: username,
        version: version
    });

    // عند دخول البوت إلى السيرفر بنجاح (Spawn)
    mcBot.on('spawn', () => {
        console.log(`[Mineflayer] البوت ${username} دخل السيرفر بنجاح.`);
        
        // إذا كان المستخدم قد كتب أوامر أو رسائل دخول تلقائية
        if (commandsText) {
            const lines = commandsText.split('\n');
            lines.forEach((line, index) => {
                setTimeout(() => {
                    if (line.trim().startsWith('/')) {
                        // تنفيذ الأمر داخل السيرفر (سواء كان سلاش عادي أو أمر نظام)
                        mcBot.chat(line.trim());
                    } else {
                        // إرسال رسالة شات عادية للاعبين
                        mcBot.chat(line.trim());
                    }
                }, (index + 1) * 1500); // تأخير زمني 1.5 ثانية بين كل سطر تجنباً للحظر المفرط (Spam)
            });
        }
    });

    // التعامل مع الأخطاء أو الطرد من السيرفر
    mcBot.on('error', (err) => {
        console.error(`[Mineflayer Error]: ${err.message}`);
    });

    mcBot.on('kicked', (reason) => {
        console.log(`[Mineflayer Kicked]: تم طرد البوت بسبب: ${reason}`);
    });
}

// تشغيل البوت عبر توكن الديسكورد
if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error("❌ خطأ: لم يتم العثور على متغير البيئة DISCORD_TOKEN");
}
