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
STAFF_ROLE_ID = os.getenv("STAFF_ROLE_ID")
STAFF_LOG_CHANNEL_ID = os.getenv("STAFF_LOG_CHANNEL_ID")
# الرابط الخاص بواجهة السجلات على ريلواي (مثال: https://your-app.up.railway.app)
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://your-railway-url.up.railway.app")

# Critical environment validation
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

# --- CONFIGURABLE PRESET DEPARTMENTS ---
DEPARTMENTS = {
    "technical": {"label": "Technical & Plugin Support", "emoji": "💻", "color": 0x00d9ff},
    "report": {"label": "Player Report / Abuse", "emoji": "🚫", "color": 0xff4d4d},
    "billing": {"label": "Store & Billing Issues", "emoji": "💰", "color": 0x4dff88},
    "general": {"label": "General Inquiry", "emoji": "📩", "color": 0xffd900}
}

# --- PERSISTENT DATA DRIVERS ---
STATS_FILE = "staff_stats.json"
active_tickets_tracking = {}  # Format: { channel_id: {creator_id, handler_id, created_at, online_staff} }

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

async def generate_and_save_transcript(channel, closed_by_user):
    """Compiles complete textual history into a clean JSON for Web Dashboard analytics."""
    messages_log = []
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
    
    os.makedirs("transcripts", exist_ok=True)
    file_path = f"transcripts/{channel.id}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(transcript_data, f, indent=4, ensure_ascii=False)


# --- INTERACTIVE UI COMPONENTS ---

class RatingView(discord.ui.View):
    """Generates 5 contextual rating buttons for performance assessment."""
    def __init__(self, handler_id, creator_id, log_channel):
        super().__init__(timeout=15.0)
        self.handler_id = handler_id
        self.creator_id = creator_id
        self.log_channel = log_channel
        self.rated = False

    async def process_rating(self, interaction: discord.Interaction, stars: int):
        if interaction.user.id != self.creator_id:
            await interaction.response.send_message("❌ Only the ticket creator can rate performance.", ephemeral=True)
            return

        self.rated = True
        self.stop()
        
        data = save_staff_rating(self.handler_id, stars)
        avg_stars = round(data["total_stars"] / data["tickets_handled"], 2)
        
        handler_user = interaction.guild.get_member(self.handler_id)
        handler_name = handler_user.mention if handler_user else f"ID: {self.handler_id}"
        
        # إنشاء زر الرابط المباشر لواجهتك المخصصة للسجلات
        link_view = discord.ui.View()
        link_view.add_item(discord.ui.Button(
            label="👁️ عرض سجل التكت / View Transcript", 
            url=f"{DASHBOARD_URL}/transcript/{interaction.channel.id}"
        ))
        
        log_embed = discord.Embed(
            title="⭐ Staff Performance Rated",
            description=f"**Staff:** {handler_name}\n**Rating:** {stars} / 5 ⭐\n**Total Closed:** {data['tickets_handled']}\n**Average Metrics:** {avg_stars} ⭐",
            color=0x00ff00
        )
        await self.log_channel.send(embed=log_embed, view=link_view)
        
        await interaction.response.send_message(f"✅ Rated {stars} stars. Saving transcript and wiping channel...", ephemeral=False)
        await generate_and_save_transcript(interaction.channel, interaction.user)
        await asyncio.sleep(2.0)
        await interaction.channel.delete()

    @discord.ui.button(label="1 ⭐", style=discord.ButtonStyle.secondary, custom_id="rate_1")
    async def star_1(self, interaction: discord.Interaction, button: discord.ui.Button): await self.process_rating(interaction, 1)
    @discord.ui.button(label="2 ⭐", style=discord.ButtonStyle.secondary, custom_id="rate_2")
    async def star_2(self, interaction: discord.Interaction, button: discord.ui.Button): await self.process_rating(interaction, 2)
    @discord.ui.button(label="3 ⭐", style=discord.ButtonStyle.secondary, custom_id="rate_3")
    async def star_3(self, interaction: discord.Interaction, button: discord.ui.Button): await self.process_rating(interaction, 3)
    @discord.ui.button(label="4 ⭐", style=discord.ButtonStyle.secondary, custom_id="rate_4")
    async def star_4(self, interaction: discord.Interaction, button: discord.ui.Button): await self.process_rating(interaction, 4)
    @discord.ui.button(label="5 ⭐", style=discord.ButtonStyle.success, custom_id="rate_5")
    async def star_5(self, interaction: discord.Interaction, button: discord.ui.Button): await self.process_rating(interaction, 5)

    async def on_timeout(self):
        """Failsafe wipe if user ignores ratings."""
        if not self.rated:
            try:
                await self.log_channel.send(f"⚠️ Ticket closed without evaluation rating for Staff ID `{self.handler_id}`.")
            except: pass


class VerificationModal(discord.ui.Modal, title="Minecraft Account Verification"):
    username = discord.ui.TextInput(label="Minecraft Username", placeholder="Enter username...", required=True)
    verify_code = discord.ui.TextInput(label="Verification Code", placeholder="Enter active game token...", required=True)

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
                        await interaction.followup.send("❌ **Verification Failed:** Invalid code validation or player offline.", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"⚠️ **Core Link Error:** API unreachable ({str(e)})", ephemeral=True)


class TicketOptionsView(discord.ui.View):
    """Persistent controls accessible inside initialized ticket matrices."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Claim Ticket", style=discord.ButtonStyle.blurple, custom_id="btn_claim_ticket", emoji="🛠️")
    async def claim_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not any(r.id == STAFF_ROLE_ID for r in interaction.user.roles):
            await interaction.response.send_message("❌ Only network administration staff can claim active tasks.", ephemeral=True)
            return
            
        t_data = active_tickets_tracking.get(interaction.channel.id)
        if t_data and t_data["handler_id"] is not None:
            await interaction.response.send_message("⚠️ Task assignment already processed by another admin.", ephemeral=True)
            return

        now = datetime.utcnow()
        t_data["handler_id"] = interaction.user.id
        t_data["claimed_at"] = now
        duration = now - t_data["created_at"]
        minutes_taken = max(1, round(duration.total_seconds() / 60))

        button.disabled = True
        button.label = f"Claimed by {interaction.user.name}"
        button.style = discord.ButtonStyle.secondary
        await interaction.message.edit(view=self)
        await interaction.response.send_message(f"⚡ **[SLA Log Metrics]:** Responded in {minutes_taken} min(s) by {interaction.user.mention}")

    @discord.ui.button(label="Verify Account", style=discord.ButtonStyle.green, custom_id="btn_verify_mc", emoji="🎮")
    async def verify_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(VerificationModal())

    @discord.ui.button(label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="btn_close_ticket", emoji="🔒")
    async def close_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        t_data = active_tickets_tracking.get(interaction.channel.id)
        creator_id = t_data["creator_id"] if t_data else None
        handler_id = t_data["handler_id"] if t_data else None

        is_staff = any(r.id == STAFF_ROLE_ID for r in interaction.user.roles)
        if interaction.user.id != creator_id and not is_staff:
            await interaction.response.send_message("❌ Access Violation: Only the ticket opener or staff can initiate closure.", ephemeral=True)
            return

        log_channel = interaction.guild.get_channel(STAFF_LOG_CHANNEL_ID)
        
        if not handler_id:
            await interaction.response.send_message("Wiping channel instantly. Directing unassigned log to transcripts archive...")
            await generate_and_save_transcript(interaction.channel, interaction.user)
            
            # إرسال سجل التكت حتى لو لم يكن التكت مُعيناً لأحد الإداريين
            if log_channel:
                link_view = discord.ui.View()
                link_view.add_item(discord.ui.Button(
                    label="👁️ عرض سجل التكت / View Transcript", 
                    url=f"{DASHBOARD_URL}/transcript/{interaction.channel.id}"
                ))
                log_embed = discord.Embed(
                    title="🔒 Ticket Closed (Unassigned)",
                    description=f"**Closed By:** {interaction.user.mention}",
                    color=0xff0000
                )
                await log_channel.send(embed=log_embed, view=link_view)
                
            await asyncio.sleep(2)
            await interaction.channel.delete()
            return

        embed = discord.Embed(
            title="🔒 Ticket Closure Protocol",
            description="Channel execution scheduled in **15 seconds**.\nPlease select performance rating metrics below.",
            color=0xff0000
        )
        rating_view = RatingView(handler_id, creator_id, log_channel)
        await interaction.response.send_message(embed=embed, view=rating_view)


class ProblemCategorySelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label=v["label"], value=k, emoji=v["emoji"]) 
            for k, v in DEPARTMENTS.items()
        ]
        super().__init__(placeholder="🔍 Select your specific tracking department...", min_values=1, max_values=1, options=options, custom_id="select_dept")

    async def callback(self, interaction: discord.Interaction):
        category = self.values[0]
        dept = DEPARTMENTS[category]
        
        # Prevent layout interface manipulation by updating text view
        embed = discord.Embed(
            title=f"{dept['emoji']} Department: {dept['label']}",
            description=(
                f"Welcome {interaction.user.mention},\n\nYour session has been routed to the respective division.\n"
                "Please present your information clearly while waiting for help.\n\n"
                "**Controls Available:**\n"
                "🎮 **Verify Account:** Seamless synchronization step.\n"
                "🛠️ **Claim Ticket:** Administration ownership handling."
            ),
            color=dept['color']
        )
        await interaction.channel.edit(name=f"{category}-{interaction.user.name}")
        await interaction.response.edit_message(embed=embed, view=TicketOptionsView())


class ProblemCategoryView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(ProblemCategorySelect())


class MainPersistentView(discord.ui.View):
    """The central access point component deployed in verification hubs."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Open Assistance Ticket", style=discord.ButtonStyle.primary, custom_id="main_open_gate", emoji="🎟️")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        category = guild.get_channel(TICKET_CATEGORY_ID)

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True, embed_links=True),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_channels=True)
        }
        
        ticket_channel = await guild.create_text_channel(
            name=f"pending-{interaction.user.name}", category=category, overwrites=overwrites
        )

        # Immediate tracking initialization to capture active online status for SLA rules
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
            title="⚡ NetPulse Systems Center",
            description="Ticket created successfully. Select your specific issue from the selection array below:",
            color=0xbf00ff
        )
        
        await ticket_channel.send(content=interaction.user.mention, embed=embed, view=ProblemCategoryView())
        await interaction.response.send_message(f"✅ Session initialized: {ticket_channel.mention}", ephemeral=True)
        
        # Fire non-blocking monitor loop
        interaction.client.loop.create_task(check_sla_breach(interaction.client, guild, ticket_channel.id))


async def check_sla_breach(bot, guild, channel_id):
    await asyncio.sleep(180)  # 3-minute strict delay monitoring
    t_data = active_tickets_tracking.get(channel_id)
    if not t_data or t_data["handler_id"] is not None:
        return

    log_channel = guild.get_channel(STAFF_LOG_CHANNEL_ID)
    if not log_channel:
        return

    lazy_mentions = []
    for staff_id in t_data["online_staff"]:
        member = guild.get_member(staff_id)
        if member and member.status != discord.Status.offline:
            lazy_mentions.append(member.mention)

    if lazy_mentions:
        staff_list = ", ".join(lazy_mentions)
        alert_embed = discord.Embed(
            title="🚨 SLA Response Breach Warning",
            description=f"Ticket <#{channel_id}> remained unclaimed for over 3 minutes!\n\n**Available Staff during setup:**\n{staff_list}",
            color=0xffaa00
        )
        await log_channel.send(embed=alert_embed)


class TicketBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True 
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self):
        # Persistent registration guarantees buttons remain functional across reboots
        self.add_view(MainPersistentView())
        self.add_view(TicketOptionsView())
        self.add_view(ProblemCategoryView())

bot = TicketBot()

@bot.event
async def on_ready():
    print(f"✨ Cyberpunk Core Engine online as {bot.user}")

@bot.command(name="setupverify")
@commands.has_permissions(administrator=True)
async def setup_verify_panel(ctx):
    embed = discord.Embed(
        title="🎮 Account Verification Hub",
        description="Click the interface down below to request custom automated pipeline links.",
        color=0xbf00ff
    )
    await ctx.send(embed=embed, view=MainPersistentView())
    await ctx.message.delete()

if __name__ == "__main__":
    bot.run(BOT_TOKEN)
