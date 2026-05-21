const mineflayer = require('mineflayer');

function createBot() {
    const bot = mineflayer.createBot({
        host: process.env.SERVER_IP, // سنضبطه في Railway
        port: parseInt(process.env.SERVER_PORT) || 25565,
        username: 'KeepAliveBot',
        version: '1.20.4' // إجبار البوت على إصدار مدعوم
    });

    bot.on('spawn', () => {
        console.log('البوت دخل السيرفر بنجاح!');
        bot.chat('I am online!');
    });

    bot.on('end', (reason) => {
        console.log('فصل الاتصال، سأعيد المحاولة بعد 10 ثواني:', reason);
        setTimeout(createBot, 10000);
    });

    bot.on('error', (err) => {
        console.log('خطأ في البوت:', err);
    });
}

createBot();
