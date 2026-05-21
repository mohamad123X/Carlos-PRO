const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

function createBot() {
    const bot = mineflayer.createBot({
        host: process.env.SERVER_IP,
        port: parseInt(process.env.SERVER_PORT) || 25565,
        username: 'KeepAliveBot',
        version: '1.20.4' 
    });

    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        console.log('تم دخول البوت للسيرفر');
        
        // تسجيل الدخول (إجباري)
        setTimeout(() => bot.chat('/register 2345@@'), 1000);
        setTimeout(() => bot.chat('/login 2345@@'), 3000);
    });

    // 1. القفز (قفزتين كل 3 ثواني)
    setInterval(() => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 400); // القفزة الأولى
        setTimeout(() => {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 400); // القفزة الثانية
        }, 600);
    }, 3000);

    // 2. الحركة الدائرية (كل 10 ثواني ينتقل لنقطة)
    const waypoints = [
        { x: -45, y: 66, z: 124 }, // استبدلها بإحداثياتك
        { x: -59, y: 66, z: 126 },
        { x: -51, y: 66, z: 122 },
        { x: -45, y: 66, z: 124 }
    ];
    
    let currentPoint = 0;
    setInterval(() => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        bot.pathfinder.setMovements(movements);
        
        const target = waypoints[currentPoint];
        bot.pathfinder.setGoal(new goals.GoalBlock(target.x, target.y, target.z));
        
        currentPoint = (currentPoint + 1) % waypoints.length;
    }, 10000);

    bot.on('end', (reason) => {
        console.log('فصل الاتصال، إعادة المحاولة...');
        setTimeout(createBot, 10000);
    });

    bot.on('error', (err) => console.log('خطأ:', err));
}

createBot();
