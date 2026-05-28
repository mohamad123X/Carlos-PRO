import discord
from discord.ext import commands
import aiohttp
import json
import os
import sys
import asyncio
from datetime import datetime

# --- SECURE CONFIGURATION VIA ENVIRONMENT VARIABLES ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
MINECRAFT_API_URL = os.getenv("MINECRAFT_API_URL", "http://your-plugin-ip:8080/api/verify")
SECRET_TOKEN = os.getenv("SECRET_TOKEN")
TICKET_CATEGORY_ID = os.getenv("TICKET_CATEGORY_ID")
STAFF_ROLE_ID = os.getenv("STAFF_ROLE_ID") # New: ID of the Staff/Admin role who handles tickets
STAFF_LOG_CHANNEL_ID = os.getenv("STAFF_LOG_CHANNEL_ID") # New: Channel to post staff ratings & SLA alerts

# Critical validation checks
if not all([BOT_TOKEN, SECRET_TOKEN, TICKET_CATEGORY_ID, STAFF_ROLE_ID, STAFF_LOG_CHANNEL_ID]):
    print("❌ Critical Error: Missing required environment variables.", file=sys.stderr)
    sys.exit(1)

try:
    TICKET_CATEGORY_ID = int(TICKET_CATEGORY_ID)
    STAFF_ROLE_ID = int(STAFF_ROLE_ID)
    STAFF_LOG_CHANNEL_ID = int(STAFF_LOG_CHANNEL_ID)
except ValueError:
    print("❌ Critical Error: IDs must be valid numerical integers.", file=sys.stderr)
    sys.exit(1)

# --- PERSISTENT STORAGE FOR STAFF PERFORMANCE ---
STATS_FILE = "staff_stats.json"

def load_staff_stats():
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_staff_rating(staff_id, stars):
    stats = load_staff_stats()
    staff_key = str(staff_id)
    if staff_key not in stats:
        stats[staff_key] = {"total_stars": 0, "tickets_handled": 0}
    
    stats[staff_key]["total_stars"] += stars
    stats[staff_key]["tickets_handled"] += 1
    
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f, indent=4)
    return stats[staff_key]

# Tracking dictionary for active ticket metadata
# Structure: { channel_id: {creator_id, handler_id, created_at, online_staff_ids} }
active_tickets_tracking = {}

# --- INTERACTIVE UI COMPONENTS ---

class RatingView(discord.ui.View):
    """
    Generates 5 buttons for performance rating (1 to 5 stars).
    """
    def __init__(self, handler_id, creator_id, log_channel):
        super().__init__(timeout=15.0) # 15 seconds grace period
        self.handler_id = handler_id
        self.creator_id = creator_id
        self.log_channel = log_channel
        self.rated = False

    async def process_rating(self, interaction: discord.Interaction, stars: int):
        if interaction.user.id != self.creator_id:
            await interaction.response.send_message("❌ Only the ticket creator can rate the performance.", ephemeral=True)
            return

        self.rated = True
        self.stop() # Stop the timeout listener
        
        # Save to local JSON file
        data = save_staff_rating(self.handler_id, stars)
        avg_stars = round(data["total_stars"] / data["tickets_handled"], 2)
        
        # Log to Admin Channel
        handler_user = interaction.guild.get_member(self.handler_id)
        handler_name = handler_user.mention if handler_user else f"ID: {self.handler_id}"
        
        log_embed = discord.Embed(
            title="⭐ Staff Performance Rated",
            description=f"**Staff:** {handler_name}\n**Rating Given:** {stars} / 5 ⭐\n**Total Tickets:** {data['tickets_handled']}\n**Average Rating:** {avg_stars} ⭐",
            color=0x00ff00
        )
        await self.log_channel.send(embed=log_embed)
        
        await interaction.response.send_message(f"Thank you! Rated {stars} stars. Closing channel now...", ephemeral=False)
        await asyncio.sleep(2.0)
        await interaction.channel.delete()

    @discord.ui.button(label="1 ⭐", style=discord.ButtonStyle.secondary, custom_id="star_1")
    async def star_1(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_rating(interaction, 1)

    @discord.ui.button(label="2 ⭐", style=discord.ButtonStyle.secondary, custom_id="star_2")
    async def star_2(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_rating(interaction, 2)

    @discord.ui.button(label="3 ⭐", style=discord.ButtonStyle.secondary, custom_id="star_3")
    async def star_3(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_rating(interaction, 3)

    @discord.ui.button(label="4 ⭐", style=discord.ButtonStyle.secondary, custom_id="star_4")
    async def star_4(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_rating(interaction, 4)

    @discord.ui.button(label="5 ⭐", style=discord.ButtonStyle.success, custom_id="star_5")
    async def star_5(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_rating(interaction, 5)

    async def on_timeout(self):
        # Triggered automatically if 15 seconds pass without input
        if not self.rated:
            try:
                await self.log_channel.send(f"⚠️ Ticket closed without rating. Staff ID profile `{self.handler_id}` unchanged.")
            except:
                pass


class VerificationModal(discord.ui.Modal, title="Minecraft Account Verification"):
    username = discord.ui.TextInput(label="Minecraft Username", placeholder="Enter your exact name...", required=True)
    verify_code = discord.ui.TextInput(label="Verification Code", placeholder="Enter code from server...", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        payload = {"discord_id": str(interaction.user.id), "username": self.username.value, "code": self.verify_code.value}
        headers = {"Authorization": f"Bearer {SECRET_TOKEN}", "Content-Type": "application/json"}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(MINECRAFT_API_URL, data=json.dumps(payload), headers=headers, timeout=5) as response:
                    if response.status == 200:
                        res_data = await response.json()
                        await interaction.followup.send(f"✅ **Success!** {res_data.get('message')}", ephemeral=True)
                        await interaction.channel.edit(name=f"✅-{self.username.value}")
                    else:
                        await interaction.followup.send("❌ **Verification Failed!** Invalid data or player offline.", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"⚠️ **Bridge Error:** Link failure ({str(e)})", ephemeral=True)


class TicketOptionsView(discord.ui.View):
    """
    Inside-ticket controls managing claiming, verification, and closure.
    """
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Claim Ticket", style=discord.ButtonStyle.blurple, custom_id="btn_claim_ticket", emoji="🛠️")
    async def claim_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Check if clicker has Staff role
        if not any(r.id == STAFF_ROLE_ID for r in interaction.user.roles):
            await interaction.response.send_message("❌ Only official network staff can claim this ticket.", ephemeral=True)
            return
            
        t_data = active_tickets_tracking.get(interaction.channel.id)
        if t_data and t_data["handler_id"] is not None:
            await interaction.response.send_message("⚠️ This ticket has already been claimed.", ephemeral=True)
            return

        # Calculate response time
        now = datetime.utcnow()
        t_data["handler_id"] = interaction.user.id
        t_data["claimed_at"] = now
        duration = now - t_data["created_at"]
        minutes_taken = max(1, round(duration.total_seconds() / 60))

        button.disabled = True
        button.label = "Claimed"
        button.style = discord.ButtonStyle.secondary
        await interaction.message.edit(view=self)

        await interaction.response.send_message(f"⚡ **[SLA Log]:** Responded within {minutes_taken} minute(s) by {interaction.user.mention}")

    @discord.ui.button(label="Verify Account", style=discord.ButtonStyle.green, custom_id="btn_verify_mc", emoji="🎮")
    async def verify_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(VerificationModal())

    @discord.ui.button(label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="btn_close_ticket", emoji="🔒")
    async def close_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        t_data = active_tickets_tracking.get(interaction.channel.id)
        creator_id = t_data["creator_id"] if t_data else None
        handler_id = t_data["handler_id"] if t_data else None

        # Absolute rule: Only Creator or handling Admin can close
        is_staff = any(r.id == STAFF_ROLE_ID for r in interaction.user.roles)
        if interaction.user.id != creator_id and not is_staff:
            await interaction.response.send_message("❌ Permission Denied. Only the ticket opener or staff can close this channel.", ephemeral=True)
            return

        log_channel = interaction.guild.get_channel(STAFF_LOG_CHANNEL_ID)
        
        # If no staff claimed it, just close directly
        if not handler_id:
            await interaction.response.send_message("Closing channel instantly since no staff claimed it...")
            await asyncio.sleep(2)
            await interaction.channel.delete()
            return

        # Trigger Performance Rating Protocol
        embed = discord.Embed(
            title="🔒 Ticket Closure & Evaluation",
            description="This channel will permanently close in **15 seconds**.\nPlease select a rating below to evaluate the staff performance.",
            color=0xff0000
        )
        
        rating_view = RatingView(handler_id, creator_id, log_channel)
        await interaction.response.send_message(embed=embed, view=rating_view)
        
        # Track 15-second grace period asynchronously
        await asyncio.sleep(15.0)
        if not rating_view.rated:
            await interaction.channel.delete()


class CreateTicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Open Verification Ticket", style=discord.ButtonStyle.blurple, custom_id="btn_open_ticket", emoji="🎟️")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        category = guild.get_channel(TICKET_CATEGORY_ID)
        
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True, embed_links=True),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_channels=True)
        }
        
        ticket_channel = await guild.create_text_channel(
            name=f"ticket-{interaction.user.name}", category=category, overwrites=overwrites
        )

        # Log online staff members at the exact moment of ticket creation for SLA tracking
        online_staff = [
            m.id for m in guild.members 
            if any(r.id == STAFF_ROLE_ID for r in m.roles) and m.status != discord.Status.offline
        ]

        active_tickets_tracking[ticket_channel.id] = {
            "creator_id": interaction.user.id,
            "handler_id": None,
            "created_at": datetime.utcnow(),
            "online_staff": online_staff
        }

        embed = discord.Embed(
            title="⚡ NetPulse Network | Verification Gate",
            description=f"Welcome {interaction.user.mention},\n\nClick **Claim Ticket** (Staff only) or **Verify Account** to proceed.",
            color=0x00ffff
        )
        await ticket_channel.send(embed=embed, view=TicketOptionsView())
        await interaction.response.send_message(f"Ticket opened: {ticket_channel.mention}", ephemeral=True)

        # Launch non-blocking SLA checking task (3 minutes delay threshold)
        interaction.client.loop.create_task(check_sla_breach(interaction.client, guild, ticket_channel.id))


async def check_sla_breach(bot, guild, channel_id):
    """
    Monitors if online staff intentionally delay or skip claiming the ticket within 3 minutes.
    """
    await asyncio.sleep(180) # 3 Minutes SLA threshold
    
    t_data = active_tickets_tracking.get(channel_id)
    if not t_data or t_data["handler_id"] is not None:
        return # Ticket was handled in time or channel already closed

    log_channel = guild.get_channel(STAFF_LOG_CHANNEL_ID)
    if not log_channel:
        return

    # Compile lazy online staff mentions
    lazy_mentions = []
    for staff_id in t_data["online_staff"]:
        member = guild.get_member(staff_id)
        if member and member.status != discord.Status.offline:
            lazy_mentions.append(member.mention)

    if lazy_mentions:
        staff_list = ", ".join(lazy_mentions)
        alert_embed = discord.Embed(
            title="🚨 SLA Response Breach Warning",
            description=f"Ticket <#{channel_id}> remained un-claimed for over 3 minutes!\n\n**Online Staff during creation:**\n{staff_list}\n\n*Action required to maintain server metrics.*",
            color=0xffaa00
        )
        await log_channel.send(embed=alert_embed)


class TicketBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True # Required for accurate online presence scanning
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self):
        self.add_view(CreateTicketView())
        self.add_view(TicketOptionsView())

bot = TicketBot()

@bot.event
async def on_ready():
    print(f"✨ Ticket System Bot is successfully online as {bot.user}")

@bot.command(name="setupverify")
@commands.has_permissions(administrator=True)
async def setup_verify_panel(ctx):
    embed = discord.Embed(
        title="🎮 Account Verification Hub",
        description="Click the button below to open a secure tracking ticket.",
        color=0xbf00ff
    )
    await ctx.send(embed=embed, view=CreateTicketView())
    await ctx.message.delete()

if __name__ == "__main__":
    bot.run(BOT_TOKEN)
# --- ADD THIS LOGIC INSIDE THE TICKETING SYSTEM (BEFORE CHANNEL DELETION) ---
# This code block goes inside the 'close_button' or inside the 'RatingView' when channel is ready to be wiped.

async def generate_and_save_transcript(channel, closed_by_user):
    """
    Asynchronously fetches all message history from the ticket channel
    and compiles it into a structured JSON archive.
    """
    messages_log = []
    
    # Fetch all messages from oldest to newest
    async for msg in channel.history(limit=None, oldest_first=True):
        time_str = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
        messages_log.append({
            "author_name": str(msg.author.name),
            "author_id": str(msg.author.id),
            "author_avatar": str(msg.author.display_avatar.url) if msg.author.avatar else "https://i.imgur.com/0z8M08X.png",
            "content": msg.content,
            "timestamp": time_str,
            "is_bot": msg.author.bot
        })
    
    transcript_data = {
        "channel_id": str(channel.id),
        "channel_name": str(channel.name),
        "closed_by": str(closed_by_user.name),
        "closed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "total_messages": len(messages_log),
        "messages": messages_log
    }
    
    # Save structurally into 'transcripts' directory
    os.makedirs("transcripts", exist_ok=True)
    file_path = f"transcripts/{channel.id}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(transcript_data, f, indent=4, ensure_ascii=False)
    print(f"💾 Secure Transcript archived successfully: {file_path}")
import discord
from discord.ext import commands
import os
import json
import asyncio
from datetime import datetime

# --- الإعدادات الإضافية للمهام والأقسام ---
# يمكنك إضافة أيدي الرتب لكل قسم لتنبيههم بشكل خاص
DEPARTMENTS = {
    "technical": {"label": "الدعم الفني التقني", "emoji": "💻", "color": 0x00d9ff},
    "report": {"label": "إبلاغ عن لاعب / مخالفة", "emoji": "🚫", "color": 0xff4d4d},
    "billing": {"label": "مشاكل الشراء والمتجر", "emoji": "💰", "color": 0x4dff88},
    "general": {"label": "استفسار عام / أخرى", "emoji": "📩", "color": 0xffd900}
}

class ProblemCategorySelect(discord.ui.Select):
    """قائمة منسدلة لاختيار نوع المشكلة فور فتح التيكيت"""
    def __init__(self):
        options = [
            discord.SelectOption(label=v["label"], value=k, emoji=v["emoji"]) 
            for k, v in DEPARTMENTS.items()
        ]
        super().__init__(placeholder="🔍 اختر قسم المساعدة المطلوب...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        category = self.values[0]
        dept = DEPARTMENTS[category]
        
        # تعطيل القائمة بعد الاختيار لمنع التلاعب
        self.view.clear_items()
        
        # تحديث القناة بناءً على القسم
        await interaction.channel.edit(name=f"{dept['emoji']}-{category}-{interaction.user.name}")
        
        embed = discord.Embed(
            title=f"{dept['emoji']} قسم: {dept['label']}",
            description=(
                f"مرحباً {interaction.user.mention}، تم توجيه طلبك للقسم المختص.\n"
                "يرجى كتابة مشكلتك بالتفصيل وانتظار الإداري المسؤول.\n\n"
                "**إجراءات متاحة:**\n"
                "🎮 اضغط على 'Verify' لربط حسابك.\n"
                "🛠️ سيقوم أحد الإداريين بعمل Claim للتيكيت قريباً."
            ),
            color=dept['color']
        )
        
        # إرسال رسالة التنبيه الجديدة مع أزرار التحكم (التحقق، الاستلام، الإغلاق)
        await interaction.response.edit_message(embed=embed, view=TicketOptionsView())

class TicketOptionsView(discord.ui.View):
    """الأزرار التي تظهر داخل التيكيت بعد اختيار القسم"""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Claim (للإدارة)", style=discord.ButtonStyle.blurple, custom_id="btn_claim", emoji="🛠️")
    async def claim(self, interaction: discord.Interaction, button: discord.ui.Button):
        # (نفس كود الـ Claim السابق مع حساب الـ SLA)
        if not any(r.id == int(os.getenv("STAFF_ROLE_ID")) for r in interaction.user.roles):
            return await interaction.response.send_message("❌ هذا الزر للموظفين فقط!", ephemeral=True)
        
        button.disabled = True
        button.label = f"استلمها: {interaction.user.name}"
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(f"✅ الإداري {interaction.user.mention} استلم التيكيت وسيقوم بمساعدتك الآن.")

    @discord.ui.button(label="التحقق من الحساب", style=discord.ButtonStyle.green, custom_id="btn_verify", emoji="🎮")
    async def verify(self, interaction: discord.Interaction, button: discord.ui.Button):
        from bot import VerificationModal # استدعاء المودال الحديث
        await interaction.response.send_modal(VerificationModal())

    @discord.ui.button(label="إغلاق وتقييم", style=discord.ButtonStyle.danger, custom_id="btn_close", emoji="🔒")
    async def close(self, interaction: discord.Interaction, button: discord.ui.Button):
        # استدعاء نظام التقييم والـ Transcript الذي برمجناه سابقاً
        await start_closure_protocol(interaction)

class ProblemCategoryView(discord.ui.View):
    """واجهة تحتوي على القائمة المنسدلة فقط"""
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(ProblemCategorySelect())

class MainPersistentView(discord.ui.View):
    """اللوحة الرئيسية التي توضع في روم #التحقق"""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="إفتح تيكيت مساعدة", style=discord.ButtonStyle.primary, custom_id="main_open", emoji="🎟️")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        category_id = int(os.getenv("TICKET_CATEGORY_ID"))
        category = guild.get_channel(category_id)

        # إنشاء القناة بصلاحيات خاصة
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(manage_channels=True, read_messages=True)
        }
        
        channel = await guild.create_text_channel(
            name=f"🎫-waiting-{interaction.user.name}",
            category=category,
            overwrites=overwrites
        )

        # إرسال قائمة اختيار الأقسام فوراً
        embed = discord.Embed(
            title="⚡ نظام تيكتات NetPulse",
            description="مرحباً بك! لكي نتمكن من مساعدتك بشكل أسرع، يرجى اختيار **نوع المشكلة** من القائمة أدناه:",
            color=0xbf00ff
        )
        await channel.send(content=interaction.user.mention, embed=embed, view=ProblemCategoryView())
        await interaction.response.send_message(f"✅ تم فتح التيكيت: {channel.mention}", ephemeral=True)
