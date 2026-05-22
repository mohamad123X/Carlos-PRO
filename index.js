const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    REST, 
    Routes,
    MessageFlags 
} = require('discord.js');
const mineflayer = require('mineflayer');

// إعداد صلاحيات البوت الأساسية
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// متغير مؤقت لتخزين بيانات الجلسة 
const userSessions = new Map();
const TOKEN = process.env.DISCORD_TOKEN;

// تعديل الحدث إلى clientReady
client.on('clientReady', async () => {
    console.log(`🔥 تم تشغيل بوت الديسكورد بنجاح باسم: ${client.user.tag}`);
    const commands = [{ name: 'spawn', description: 'إدخال بوت لاعب إلى سيرفر ماين كرافت الخاص بك' }];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل أوامر السلاش بنجاح!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
});

// التعامل مع التفاعلات
client.on('interactionCreate', async interaction => {
    
    // 1. أمر التشغيل /spawn وإنشاء قائمة الإصدارات
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'spawn') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_version')
                .setPlaceholder('اختر إصدار سيرفر ماين كرافت...')
                .addOptions(
                    // تم إضافة الإصدار المطلوب بناءً على الصورة مع إصدارات أخرى مدعومة
                    new StringSelectMenuOptionBuilder().setLabel('1.8.9').setValue('1.8.9'),
                    new StringSelectMenuOptionBuilder().setLabel('1.12.2').setValue('1.12.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.16.5').setValue('1.16.5'),
                    new StringSelectMenuOptionBuilder().setLabel('1.18.2').setValue('1.18.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.19.4').setValue('1.19.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.1').setValue('1.20.1'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.4').setValue('1.20.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.21').setValue('1.21'),
                    new StringSelectMenuOptionBuilder().setLabel('26.1.2').setValue('26.1.2') // الإصدار المحدد في الصورة
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.reply({ 
                content: '⚙️ يرجى اختيار إصدار السيرفر من القائمة أدناه:', 
                components: [row], 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    }

    // 2. معالجة اختيار الإصدار وإظهار النافذة المنبثقة
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_version') {
            const selectedVersion = interaction.values[0];
            
            userSessions.set(interaction.user.id, { version: selectedVersion });

            const modal = new ModalBuilder()
                .setCustomId('bot_details_modal')
                .setTitle(`بيانات الدخول (إصدار ${selectedVersion})`);

            const ipInput = new TextInputBuilder().setCustomId('mc_ip').setLabel('عنوان السيرفر (IP)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('مثال: my-server.magmanode.net');
            const portInput = new TextInputBuilder().setCustomId('mc_port').setLabel('البورت (Port)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('25565 (اتركه فارغاً للافتراضي)');
            const usernameInput = new TextInputBuilder().setCustomId('mc_username').setLabel('اسم لاعب البوت (Username)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Aternot_Bot');
            const commandsInput = new TextInputBuilder().setCustomId('mc_commands').setLabel('أوامر/رسائل الدخول (سطر لكل أمر)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('/login mypassword\nمرحباً بالجميع!');

            modal.addComponents(
                new ActionRowBuilder().addComponents(ipInput),
                new ActionRowBuilder().addComponents(portInput),
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(commandsInput)
            );

            await interaction.showModal(modal);
        }
    }

    // 3. استلام البيانات من النافذة المنبثقة وتشغيل البوت
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'bot_details_modal') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const ip = interaction.fields.getTextInputValue('mc_ip');
            const portStr = interaction.fields.getTextInputValue('mc_port');
            const port = portStr ? parseInt(portStr) : 25565;
            const username = interaction.fields.getTextInputValue('mc_username');
            const commandsText = interaction.fields.getTextInputValue('mc_commands');

            const session = userSessions.get(interaction.user.id);
            const version = session ? session.version : '1.20.4';

            await interaction.followUp({ content: `🚀 جاري محاولة تشغيل البوت **${username}** وإرساله إلى \`${ip}:${port}\`...` });

            // استدعاء محرك Mineflayer مع تمرير تفاعل الديسكورد
            createMinecraftBot(ip, port, username, version, commandsText, interaction);
        }
    }
});

// دالة محرك Mineflayer المصححة والمحمية من الانهيار بالكامل
function createMinecraftBot(host, port, username, version, commandsText, interaction) {
    try {
        const mcBot = mineflayer.createBot({
            host: host,
            port: port,
            username: username,
            version: version // تم تصحيح البروتوكول لدعم هذا الإصدار
        });

        mcBot.on('spawn', () => {
            console.log(`[Mineflayer] البوت ${username} دخل السيرفر بنجاح.`);
            
            if (commandsText) {
                const lines = commandsText.split('\n');
                lines.forEach((line, index) => {
                    setTimeout(() => {
                        const textToSend = line.trim();
                        if (textToSend) {
                            mcBot.chat(textToSend);
                        }
                    }, (index + 1) * 1500); 
                });
            }
        });

        // إمساك أخطاء الاتصال الداخلي
        mcBot.on('error', async (err) => {
            console.error(`[Mineflayer Error]: ${err.message}`);
            try {
                await interaction.followUp({ content: `❌ فشل اتصال لاعب ماين كرافت: ${err.message}` });
            } catch (e) { console.log("تعذر إرسال رسالة الخطأ للديسكورد") }
        });

        mcBot.on('kicked', async (reason) => {
            console.log(`[Mineflayer Kicked]: تم طرد البوت: ${reason}`);
            try {
                await interaction.followUp({ content: `⚠️ تم طرد لاعب ماين كرافت من السيرفر. السبب: ${reason}` });
            } catch (e) { console.log("تعذر إرسال رسالة الطرد للديسكورد") }
        });

    } catch (error) {
        // حماية الخادم من الانهيار
        console.error(`[Fatal Creation Error]: ${error.message}`);
        interaction.followUp({ content: `❌ خطأ كارثي في إنشاء البوت. السبب: ${error.message}` });
    }
}

if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error("❌ خطأ: لم يتم العثور على متغير البيئة DISCORD_TOKEN");
}
