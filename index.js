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
    ChannelType,
    PermissionsBitField,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

// إعداد قاعدة بيانات بسيطة لحفظ إعدادات السيرفرات
const dbPath = path.join(__dirname, 'database.json');
function loadDB() {
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(dbPath));
}
function saveDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // ضروري لقراءة رسائل الشات
    ]
});

// متغير لحفظ البوتات الشغالة حالياً بناءً على آيدي السيرفر
const activeMinecraftBots = new Map();
const TOKEN = process.env.DISCORD_TOKEN;

// 1. تسجيل أوامر السلاش عند تشغيل البوت
client.on('clientReady', async () => {
    console.log(`🔥 تم تشغيل بوت الديسكورد بنجاح باسم: ${client.user.tag}`);
    
    const commands = [
        {
            name: 'setup',
            description: 'تثبيت نظام بوت ماين كرافت عبر نافذة منبثقة',
            options: [
                { type: 8, name: 'allowed_role', description: 'الرتبة المسموح لها بإدارة البوت', required: true },
                { type: 3, name: 'server_type', description: 'نوع الحساب', required: true, choices: [{name: 'مكرك (Offline)', value: 'offline'}, {name: 'أصلي (Premium)', value: 'online'}] }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل أمر التثبيت /setup بنجاح!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
});

// 2. معالجة التفاعلات (أوامر، أزرار، قوائم، ونوافذ منبثقة)
client.on('interactionCreate', async interaction => {
    
    // ==========================================
    // أ- التعامل مع أمر التثبيت /setup (إظهار النافذة المنبثقة)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ يجب أن تكون مسؤولاً (Administrator) لاستخدام هذا الأمر.', ephemeral: true });
        }

        const allowedRole = interaction.options.getRole('allowed_role');
        const serverType = interaction.options.getString('server_type');

        // إنشاء النافذة المنبثقة (Modal)
        // نقوم بحفظ الـ Role ID ونوع السيرفر في الـ CustomId لنسترجعها بعد الإرسال
        const modal = new ModalBuilder()
            .setCustomId(`setup_modal_${allowedRole.id}_${serverType}`)
            .setTitle('⚙️ إعدادات سيرفر ماين كرافت');

        const botNameInput = new TextInputBuilder()
            .setCustomId('setup_bot_name')
            .setLabel('🤖 اسم البوت (اللاعب) في ماين كرافت:')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('مثال: AFK_Bot')
            .setRequired(true);

        const serverIpInput = new TextInputBuilder()
            .setCustomId('setup_server_ip')
            .setLabel('🌐 عنوان السيرفر (IP):')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('مثال: play.server.com')
            .setRequired(true);

        const serverPortInput = new TextInputBuilder()
            .setCustomId('setup_server_port')
            .setLabel('🔌 بورت السيرفر (اتركه فارغاً للأساسي 25565):')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('25565')
            .setRequired(false);

        const chatChannelInput = new TextInputBuilder()
            .setCustomId('setup_chat_channel')
            .setLabel('💬 اسم قناة الشات (لربط الشات باللعبة):')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('مثال: شات-ماينكرافت')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(botNameInput),
            new ActionRowBuilder().addComponents(serverIpInput),
            new ActionRowBuilder().addComponents(serverPortInput),
            new ActionRowBuilder().addComponents(chatChannelInput)
        );

        await interaction.showModal(modal);
    }

    // ==========================================
    // ب- استلام بيانات النافذة المنبثقة وإنشاء النظام
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('setup_modal_')) {
        await interaction.deferReply({ ephemeral: true });

        // استخراج الرتبة ونوع السيرفر من الآيدي
        const params = interaction.customId.split('_');
        const allowedRoleId = params[2];
        const serverType = params[3];

        const botName = interaction.fields.getTextInputValue('setup_bot_name');
        const serverIp = interaction.fields.getTextInputValue('setup_server_ip');
        const serverPortStr = interaction.fields.getTextInputValue('setup_server_port');
        const serverPort = serverPortStr ? parseInt(serverPortStr) : 25565;
        const chatChName = interaction.fields.getTextInputValue('setup_chat_channel');

        try {
            // إنشاء Category بصلاحيات مخصصة
            const category = await interaction.guild.channels.create({
                name: '⚙️ نظام إدارة ماين كرافت',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // منع الجميع
                    { id: allowedRoleId, allow: [PermissionsBitField.Flags.ViewChannel] } // السماح للرتبة
                ]
            });

            // إنشاء القنوات (بعضها بأسماء تلقائية جميلة لتوفير الوقت، وواحدة باسم مخصص للشات)
            const controlCh = await interaction.guild.channels.create({ name: 'لوحة-التحكم-🎮', type: ChannelType.GuildText, parent: category.id });
            const settingsCh = await interaction.guild.channels.create({ name: 'الإعدادات-⚙️', type: ChannelType.GuildText, parent: category.id });
            const logsCh = await interaction.guild.channels.create({ name: 'سجلات-البوت-📜', type: ChannelType.GuildText, parent: category.id });
            const chatCh = await interaction.guild.channels.create({ name: chatChName, type: ChannelType.GuildText, parent: category.id });

            // حفظ الإعدادات في قاعدة البيانات
            const db = loadDB();
            db[interaction.guild.id] = {
                botName, serverIp, serverPort, serverType,
                controlChannelId: controlCh.id,
                settingsChannelId: settingsCh.id,
                logsChannelId: logsCh.id,
                chatChannelId: chatCh.id // حفظ قناة الشات الجديدة
            };
            saveDB(db);

            // إعداد رسالة التحكم
            const controlEmbed = new EmbedBuilder()
                .setTitle('🎮 لوحة تحكم بوت ماين كرافت')
                .setDescription('استخدم الأزرار أدناه لتشغيل أو إيقاف البوت بحرية.')
                .setColor('Blue');
            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_start_bot').setLabel('🟢 تشغيل البوت').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_stop_bot').setLabel('🔴 إطفاء البوت').setStyle(ButtonStyle.Danger)
            );
            await controlCh.send({ embeds: [controlEmbed], components: [controlRow] });

            // إعداد رسالة الإعدادات
            sendSettingsMessage(settingsCh, db[interaction.guild.id]);

            // رسالة ترحيبية في قناة الشات
            await chatCh.send('💬 **مرحباً بك في قناة الشات المباشر!**\nأي رسالة تكتبها هنا (أثناء تشغيل البوت) سيتم إرسالها داخل اللعبة مباشرة وكأن البوت هو من كتبها.');

            await interaction.followUp({ content: '✅ تم تثبيت النظام وإنشاء القنوات بنجاح!' });
        } catch (err) {
            console.error(err);
            await interaction.followUp({ content: '❌ حدث خطأ أثناء إنشاء القنوات. تأكد من إعطاء البوت صلاحية Administrator.' });
        }
    }

    // ==========================================
    // ج- التعامل مع الأزرار (تشغيل / إطفاء / تعديل)
    // ==========================================
    if (interaction.isButton()) {
        const db = loadDB();
        const config = db[interaction.guild.id];
        if (!config) return interaction.reply({ content: '❌ لم يتم تثبيت البوت في هذا السيرفر.', ephemeral: true });

        // زر التشغيل
        if (interaction.customId === 'btn_start_bot') {
            if (activeMinecraftBots.has(interaction.guild.id)) {
                return interaction.reply({ content: '⚠️ البوت يعمل بالفعل!', ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_version_start')
                .setPlaceholder('اختر إصدار السيرفر للبدء...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('🔍 تلقائي (Auto Detect)').setValue('auto'),
                    new StringSelectMenuOptionBuilder().setLabel('1.16.5').setValue('1.16.5'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.1').setValue('1.20.1'),
                    new StringSelectMenuOptionBuilder().setLabel('1.20.4').setValue('1.20.4')
                );
            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({ content: '⚙️ اختر الإصدار لبدء التشغيل:', components: [row], ephemeral: true });
        }

        // زر الإطفاء
        if (interaction.customId === 'btn_stop_bot') {
            const mcBot = activeMinecraftBots.get(interaction.guild.id);
            if (!mcBot) return interaction.reply({ content: '⚠️ البوت لا يعمل حالياً.', ephemeral: true });
            
            mcBot.quit();
            activeMinecraftBots.delete(interaction.guild.id);
            await interaction.reply({ content: '🔴 تم إرسال أمر الإيقاف. سيخرج البوت من السيرفر الآن.', ephemeral: true });
        }

        // زر تعديل الإعدادات
        if (interaction.customId === 'btn_edit_settings') {
            const modal = new ModalBuilder().setCustomId('modal_edit_settings').setTitle('تعديل إعدادات البوت');
            
            const ipInput = new TextInputBuilder().setCustomId('edit_ip').setLabel('عنوان السيرفر (IP)').setStyle(TextInputStyle.Short).setValue(config.serverIp);
            const portInput = new TextInputBuilder().setCustomId('edit_port').setLabel('البورت (Port)').setStyle(TextInputStyle.Short).setValue(String(config.serverPort));
            const nameInput = new TextInputBuilder().setCustomId('edit_name').setLabel('اسم البوت').setStyle(TextInputStyle.Short).setValue(config.botName);

            modal.addComponents(
                new ActionRowBuilder().addComponents(ipInput),
                new ActionRowBuilder().addComponents(portInput),
                new ActionRowBuilder().addComponents(nameInput)
            );
            await interaction.showModal(modal);
        }
    }

    // ==========================================
    // د- التعامل مع اختيار الإصدار وبدء المحرك
    // ==========================================
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_version_start') {
        await interaction.deferReply({ ephemeral: true });
        
        const db = loadDB();
        const config = db[interaction.guild.id];
        const version = interaction.values[0];

        await interaction.followUp({ content: `🚀 جاري تشغيل البوت **${config.botName}** والاتصال بالسيرفر...` });
        startMinecraftBot(interaction.guild, config, version);
    }

    // ==========================================
    // هـ- التعامل مع حفظ تعديلات الإعدادات
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId === 'modal_edit_settings') {
        const db = loadDB();
        const config = db[interaction.guild.id];
        
        config.serverIp = interaction.fields.getTextInputValue('edit_ip');
        config.serverPort = parseInt(interaction.fields.getTextInputValue('edit_port')) || 25565;
        config.botName = interaction.fields.getTextInputValue('edit_name');
        
        saveDB(db);
        sendSettingsMessage(interaction.channel, config);
        await interaction.reply({ content: '✅ تم حفظ التعديلات بنجاح!', ephemeral: true });
    }
});

// ==========================================
// 3. نظام إرسال الرسائل من الديسكورد إلى ماين كرافت
// ==========================================
client.on('messageCreate', async message => {
    // تجاهل رسائل البوتات لتجنب التكرار اللانهائي
    if (message.author.bot || !message.guild) return;

    const db = loadDB();
    const config = db[message.guild.id];
    if (!config) return;

    // تم التحديث: التحقق مما إذا كانت الرسالة في قناة الشات المخصصة أو قناة السجلات
    if (message.channel.id === config.chatChannelId || message.channel.id === config.logsChannelId) {
        const mcBot = activeMinecraftBots.get(message.guild.id);
        
        // التحقق من أن البوت شغال وموجود داخل اللعبة (entity is loaded)
        if (mcBot && mcBot.entity) {
            // إرسال محتوى رسالة الديسكورد إلى شات ماين كرافت
            mcBot.chat(message.content);
            // إضافة تفاعل (Reaction) لتأكيد وصول الرسالة
            await message.react('✅').catch(() => {}); 
        } else {
            // في حال كان البوت مطفأ أو لم يدخل بعد، نضع علامة إكس حمراء
            await message.react('❌').catch(() => {});
        }
    }
});


// ==========================================
// 4. دوال مساعدة لمحرك ماين كرافت والإعدادات
// ==========================================
async function sendSettingsMessage(channel, config) {
    const embed = new EmbedBuilder()
        .setTitle('⚙️ إعدادات السيرفر الحالية')
        .addFields(
            { name: 'اسم البوت', value: `\`${config.botName}\``, inline: true },
            { name: 'الآي بي (IP)', value: `\`${config.serverIp}\``, inline: true },
            { name: 'البورت (Port)', value: `\`${config.serverPort}\``, inline: true },
            { name: 'نوع الحساب', value: `\`${config.serverType}\``, inline: true }
        )
        .setColor('Orange');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_edit_settings').setLabel('✏️ تعديل البيانات').setStyle(ButtonStyle.Primary)
    );

    const messages = await channel.messages.fetch({ limit: 10 });
    await channel.bulkDelete(messages).catch(() => {});
    
    await channel.send({ embeds: [embed], components: [row] });
}

function startMinecraftBot(guild, config, version) {
    try {
        const botOptions = {
            host: config.serverIp,
            port: config.serverPort,
            username: config.botName,
            auth: config.serverType 
        };

        if (version !== 'auto') botOptions.version = version;

        const mcBot = mineflayer.createBot(botOptions);
        activeMinecraftBots.set(guild.id, mcBot);

        const sendLog = (message) => {
            const logsChannel = guild.channels.cache.get(config.logsChannelId);
            if (logsChannel) logsChannel.send(message);
        };

        mcBot.on('spawn', () => {
            sendLog(`🟢 **تم الاتصال!** دخل البوت \`${config.botName}\` إلى السيرفر وهو الآن ثابت في مكانه.`);
            
            // الحل: تصفير أي حركة وإرسال حزمة (تحديث الرؤية) للسيرفر ليعرف أن البوت متواجد
            mcBot.clearControlStates();
            
            setTimeout(() => {
                if (mcBot.entity) {
                    // تحديث زاوية الكاميرا فقط لمنع الطرد بدون المشي
                    mcBot.look(mcBot.entity.yaw, mcBot.entity.pitch, true).catch(() => {});
                }
            }, 1000);
        });

        mcBot.on('end', () => {
            sendLog(`🔴 **انقطع الاتصال.** خرج البوت من السيرفر.`);
            activeMinecraftBots.delete(guild.id);
        });

        mcBot.on('kicked', (reason) => {
            const kickReason = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
            sendLog(`⚠️ **تم طرد البوت!** السبب: \n\`\`\`json\n${kickReason}\n\`\`\``);
            activeMinecraftBots.delete(guild.id);
        });

        mcBot.on('death', () => {
            sendLog(`💀 **البوت مات!** عظم الله أجركم.`);
        });

        mcBot.on('message', (jsonMsg) => {
            const messageText = jsonMsg.toString().trim();
            if (messageText && messageText.length > 1) {
                // إرسال ما يكتب في ماين كرافت إلى الديسكورد
                sendLog(`💬 [شات اللعبة]: ${messageText}`);
            }
        });

        mcBot.on('error', (err) => {
            sendLog(`❌ **حدث خطأ برمجي:** ${err.message}`);
            activeMinecraftBots.delete(guild.id);
        });

    } catch (error) {
        console.error(`خطأ في الإنشاء: ${error.message}`);
        activeMinecraftBots.delete(guild.id);
    }
}

if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error("❌ لم يتم العثور على توكن الديسكورد!");
}
