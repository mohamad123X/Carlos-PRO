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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const userSessions = new Map();
const TOKEN = process.env.DISCORD_TOKEN;

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

client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'spawn') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_version')
                .setPlaceholder('اختر إصدار السيرفر (يُفضل اختيار التلقائي)...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('🔍 تلقائي (Auto Detect) - مستحسن').setValue('auto'),
                    new StringSelectMenuOptionBuilder().setLabel('1.8.9').setValue('1.8.9'),
                    new StringSelectMenuOptionBuilder().setLabel('1.12.2').setValue('1.12.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.16.5').setValue('1.16.5'),
                    new StringSelectMenuOptionBuilder().setLabel('1.18.2').setValue('1.18.2'),
                    new StringSelectMenuOptionBuilder().setLabel('1.19.4').setValue('1.19.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.1').setValue('1.20.1'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.4').setValue('1.20.4'),
                    new StringSelectMenuOptionBuilder().setLabel('1.21').setValue('1.21')
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.reply({ 
                content: '⚙️ يرجى اختيار إصدار السيرفر من القائمة أدناه:', 
                components: [row], 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_version') {
            const selectedVersion = interaction.values[0];
            userSessions.set(interaction.user.id, { version: selectedVersion });

            const displayVersion = selectedVersion === 'auto' ? 'فحص تلقائي' : selectedVersion;

            const modal = new ModalBuilder()
                .setCustomId('bot_details_modal')
                .setTitle(`بيانات الدخول (${displayVersion})`);

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

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'bot_details_modal') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const ip = interaction.fields.getTextInputValue('mc_ip');
            const portStr = interaction.fields.getTextInputValue('mc_port');
            const port = portStr ? parseInt(portStr) : 25565;
            const username = interaction.fields.getTextInputValue('mc_username');
            const commandsText = interaction.fields.getTextInputValue('mc_commands');

            const session = userSessions.get(interaction.user.id);
            const version = session ? session.version : 'auto';

            await interaction.followUp({ content: `🚀 جاري فحص السيرفر وتشغيل البوت **${username}** وإرساله إلى \`${ip}:${port}\`...` });

            createMinecraftBot(ip, port, username, version, commandsText, interaction);
        }
    }
});

function createMinecraftBot(host, port, username, version, commandsText, interaction) {
    try {
        const botOptions = {
            host: host,
            port: port,
            username: username,
            // تفعيل نظام الحسابات المكركة لضمان قبول البوت في السيرفرات العادية
            auth: 'offline' 
        };

        if (version && version !== 'auto') {
            botOptions.version = version;
        }

        const mcBot = mineflayer.createBot(botOptions);

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

        mcBot.on('error', async (err) => {
            console.error(`[Mineflayer Error]: ${err.message}`);
            try {
                await interaction.followUp({ content: `❌ فشل اتصال لاعب ماين كرافت: ${err.message}` });
            } catch (e) { console.log("تعذر إرسال رسالة الخطأ") }
        });

        // تحسين قراءة حدث الطرد لتحويل الكائن المعقد إلى نص مفهوم
        mcBot.on('kicked', async (reason) => {
            // تحويل سبب الطرد (سواء كان نصاً أو كائناً) إلى صيغة نصية واضحة للسجل وللديسكورد
            const kickReasonClean = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
            console.log(`[Mineflayer Kicked]: تم طرد البوت. السبب الخام: ${kickReasonClean}`);
            
            // محاولة استخلاص النص المفهوم إذا كان الهيكل يحتوي على حقل text (نظام ماين كرافت القياسي للرسائل)
            let friendlyReason = "تعذر تحديد السبب بدقة، راجع سجلات المنصة.";
            if (reason && reason.text) {
                friendlyReason = reason.text;
            } else if (reason && reason.extra && reason.extra[0]) {
                friendlyReason = reason.extra.map(e => e.text || '').join('');
            } else {
                friendlyReason = kickReasonClean;
            }

            try {
                await interaction.followUp({ content: `⚠️ تم طرد لاعب ماين كرافت من السيرفر.\n**السبب المكتشف:** ${friendlyReason}` });
            } catch (e) { console.log("تعذر إرسال رسالة الطرد للديسكورد") }
        });

    } catch (error) {
        console.error(`[Fatal Creation Error]: ${error.message}`);
        interaction.followUp({ content: `❌ خطأ في إنشاء البوت: ${error.message}` });
    }
}

if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error("❌ خطأ: لم يتم العثور على متغير البيئة DISCORD_TOKEN");
}
