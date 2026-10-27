import 'dotenv/config';

import {
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} from 'discord.js';

import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType,
    entersState
} from '@discordjs/voice';

import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';


// =====================================================
// CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// =====================================================
// PERSISTENT BIRTHDAY DATA
// =====================================================
// Set DATA_DIR=/data on Railway and attach a persistent
// volume mounted at /data. The default is local ./data.
const DATA_DIR = process.env.DATA_DIR || './data';
const DATA_FILE = path.join(DATA_DIR, 'batcat-data.json');

let storedData = { birthdays: {}, lastAnnounced: {} };
let dataWriteQueue = Promise.resolve();

async function loadStoredData() {
    await mkdir(DATA_DIR, { recursive: true });
    try {
        const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8'));
        storedData = {
            birthdays: parsed.birthdays || {},
            lastAnnounced: parsed.lastAnnounced || {}
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('❌ Could not read birthday data:', error);
        }
        await saveStoredData();
    }
}

function saveStoredData() {
    // Serialize writes so simultaneous registrations cannot overwrite each other.
    dataWriteQueue = dataWriteQueue.then(async () => {
        await mkdir(DATA_DIR, { recursive: true });
        const tempFile = `${DATA_FILE}.tmp`;
        await writeFile(tempFile, JSON.stringify(storedData, null, 2), 'utf8');
        const { rename } = await import('node:fs/promises');
        await rename(tempFile, DATA_FILE);
    });
    return dataWriteQueue;
}

function getLocalDateParts(date = new Date()) {
    const timeZone = process.env.TIMEZONE || 'Asia/Ho_Chi_Minh';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        year: values.year,
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        dateKey: `${values.year}-${values.month}-${values.day}`
    };
}

function parseBirthday(value) {
    const match = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/.exec(value.trim());
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    if (day > daysInMonth) return null;
    return { month, day };
}

// =====================================================
// VOICE TTS SESSION
// =====================================================
const voicePlayer = createAudioPlayer();
let voiceSession = null;
let ttsEnabled = true;
const speechQueue = [];
let isSpeakingQueue = false;
let lastQueuedAt = 0;

voicePlayer.on('error', error => {
    console.error('❌ TTS audio player error:', error.message);
});

function getMemberVoiceChannel(member) {
    return member?.voice?.channel || null;
}

async function connectTTS(interaction) {
    const voiceChannel = getMemberVoiceChannel(interaction.member);
    if (!voiceChannel) {
        await interaction.reply({
            content: '🔊 Join the voice channel you want BatCat to use, then run `/voice on` in the text channel he should read. You no longer need `/voice join`.',
            ephemeral: true
        });
        return;
    }

    try {
        ttsEnabled = true;

        // If BatCat is already in this VC, simply switch the text channel
        // being monitored and enable TTS without reconnecting.
        if (
            voiceSession?.connection &&
            voiceSession.guildId === interaction.guildId &&
            voiceSession.voiceChannelId === voiceChannel.id &&
            voiceSession.connection.state.status !== VoiceConnectionStatus.Destroyed
        ) {
            voiceSession.textChannelId = interaction.channelId;
            voiceSession.connection.subscribe(voicePlayer);

            await interaction.reply({
                content: `🦇 BatCat is already in **${voiceChannel.name}**. Automatic TTS is now on for this text channel.`,
                ephemeral: true
            });
            return;
        }

        if (voiceSession?.connection) {
            try {
                voiceSession.connection.destroy();
            } catch {}
        }
        voiceSession = null;

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 25_000);

        voiceSession = {
            connection,
            guildId: interaction.guildId,
            voiceChannelId: voiceChannel.id,
            textChannelId: interaction.channelId
        };
        connection.subscribe(voicePlayer);

        await interaction.reply({
            content: `🦇 BatCat automatically joined **${voiceChannel.name}**. TTS is on for this text channel using a free Microsoft Edge voice. You can use \`/voice off\` to pause speech or \`/voice leave\` to disconnect.`,
            ephemeral: true
        });

        if (interaction.channel?.isTextBased()) {
            await interaction.channel.send(
                '🦇 **BatCat TTS is active.** Eligible messages from people in his voice channel will be read aloud. Run `/voice on` again from another text channel to switch what he reads.'
            );
        }
    } catch (error) {
        console.error('❌ Could not join voice channel:', error);
        if (voiceSession?.connection) {
            try {
                voiceSession.connection.destroy();
            } catch {}
        }
        voiceSession = null;

        if (!interaction.replied) {
            await interaction.reply({
                content: '⚠️ I could not join that voice channel. Check BatCat has View Channel, Connect, and Speak permissions.',
                ephemeral: true
            });
        }
    }
}

async function synthesizeSpeech(text) {
    // Free Microsoft Edge Read Aloud voice. This is an online service,
    // so it needs internet access but does not use an OpenAI API key.
    const tts = new MsEdgeTTS({
        connectionTimeoutMs: 15000,
        synthesisTimeoutMs: 60000
    });

    const voice = process.env.EDGE_TTS_VOICE || 'en-US-AriaNeural';
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(text);
    const chunks = [];

    await new Promise((resolve, reject) => {
        audioStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        audioStream.once('end', resolve);
        audioStream.once('error', reject);
        audioStream.once('close', () => {
            if (chunks.length > 0) resolve();
        });
    });

    const audio = Buffer.concat(chunks);
    if (!audio.length) {
        throw new Error('Edge TTS returned an empty audio stream.');
    }
    return audio;
}

function mp3ToPcm(mp3Buffer) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            '-i', 'pipe:0',
            '-f', 's16le', '-ar', '48000', '-ac', '2',
            'pipe:1'
        ]);

        const output = [];
        let stderr = '';
        ffmpeg.stdout.on('data', chunk => output.push(chunk));
        ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString(); });
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => {
            if (code === 0) resolve(Buffer.concat(output));
            else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 500)}`));
        });
        ffmpeg.stdin.on('error', () => {});
        ffmpeg.stdin.end(mp3Buffer);
    });
}

async function playSpeech(text) {
    if (!voiceSession || !ttsEnabled) return;

    const mp3 = await synthesizeSpeech(text);
    const pcm = await mp3ToPcm(mp3);
    if (!voiceSession || !ttsEnabled) return;

    const stream = new PassThrough();
    const resource = createAudioResource(stream, { inputType: StreamType.Raw });
    voicePlayer.play(resource);
    stream.end(pcm);

    await entersState(voicePlayer, AudioPlayerStatus.Playing, 15_000);
    await entersState(voicePlayer, AudioPlayerStatus.Idle, 120_000);
}

async function processSpeechQueue() {
    if (isSpeakingQueue) return;
    isSpeakingQueue = true;
    try {
        while (speechQueue.length > 0) {
            const item = speechQueue.shift();
            if (!voiceSession || !ttsEnabled) continue;
            try {
                await playSpeech(item);
            } catch (error) {
                console.error('❌ Free Edge TTS failed:', error.message);
            }
        }
    } finally {
        isSpeakingQueue = false;
    }
}

function enqueueMessageForTTS(message) {
    if (!voiceSession || !ttsEnabled || message.author.bot) return;
    if (message.guildId !== voiceSession.guildId) return;
    if (message.channelId !== voiceSession.textChannelId) return;

    const memberVoiceChannel = getMemberVoiceChannel(message.member);
    if (!memberVoiceChannel || memberVoiceChannel.id !== voiceSession.voiceChannelId) return;

    const content = message.content?.trim();
    if (!content || content.startsWith('/') || content.startsWith('!')) return;
    if (/https?:\/\/|www\.|discord\.gg\//i.test(content)) return;
    if (message.attachments.size > 0 && !content) return;

    const cleaned = content
        .replace(/<@!?\d+>/g, 'someone')
        .replace(/<#[0-9]+>/g, 'a channel')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/[*_~`|>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 350);

    if (!cleaned) return;
    const now = Date.now();
    if (now - lastQueuedAt < 1200) return; // avoid rapid-fire spam
    if (speechQueue.length >= 8) return; // keep the queue bounded
    lastQueuedAt = now;

    speechQueue.push(`${message.member?.displayName || message.author.username} says: ${cleaned}`);
    void processSpeechQueue();
}

async function checkBirthdays() {
    const channelId = process.env.BIRTHDAY_CHANNEL_ID;
    if (!channelId || !client.isReady()) return;

    const today = getLocalDateParts();

    // Announce only during 09:00 Vietnam-local time. Never send greetings
    // immediately on startup or catch up missed announcements later.
    if (today.hour !== 9 || today.minute !== 0) return;

    for (const [userId, birthday] of Object.entries(storedData.birthdays)) {
        if (birthday.month !== today.month || birthday.day !== today.day) continue;
        if (storedData.lastAnnounced[userId] === today.dateKey) continue;

        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                console.error('❌ BIRTHDAY_CHANNEL_ID is not a text channel.');
                return;
            }
            await channel.send(`🎂 Happy birthday, <@${userId}>! Everyone at FUN FUN wishes you an amazing day! 🎉`);
            storedData.lastAnnounced[userId] = today.dateKey;
            await saveStoredData();
        } catch (error) {
            console.error(`❌ Birthday announcement failed for ${userId}:`, error.message);
        }
    }
}


// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check if BatCat is working.'),

    new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Control BatCat voice-chat TTS.')
        .addSubcommand(subcommand =>
            subcommand.setName('join').setDescription('Optional: join your voice channel and read this text channel aloud.')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('leave').setDescription('Leave voice chat and stop TTS.')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('on').setDescription('Automatically join your current voice channel and enable TTS for this text channel.')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('off').setDescription('Pause automatic message reading.')
        ),

    new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Set or update your birthday (month and day only).')
        .addSubcommand(subcommand =>
            subcommand.setName('set')
                .setDescription('Privately save your birthday.')
                .addIntegerOption(option =>
                    option.setName('month').setDescription('Birth month (1–12)').setMinValue(1).setMaxValue(12).setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('day').setDescription('Birth day').setMinValue(1).setMaxValue(31).setRequired(true)
                )
        )
].map(command => command.toJSON());

const rest = new REST({
    version: '10'
}).setToken(
    process.env.DISCORD_TOKEN
);


// =====================================================
// ROLE SETTINGS
// =====================================================

const memberRoleName = 'Fancy Members';

const selectableRoles = [
    'Hero Realms',
    'Sword Trials',
    'Talents',
    'Speed Run',
    'Perception Forest'
];


// =====================================================
// FIND ROLE
// =====================================================

function findRoleByName(guild, roleName) {

    return guild.roles.cache.find(
        role => role.name === roleName
    );
}


// =====================================================
// WELCOME PANEL
// =====================================================

async function ensureWelcomePanel() {

    try {

        const welcomeChannelId =
            process.env.WELCOME_CHANNEL_ID;

        if (!welcomeChannelId) {

            console.error(
                '❌ WELCOME_CHANNEL_ID is undefined!'
            );

            return;
        }

        console.log(
            '👋 Welcome channel ID:',
            welcomeChannelId
        );


        const channel =
            await client.channels.fetch(
                welcomeChannelId
            );


        if (!channel) {

            console.error(
                '❌ Welcome channel could not be found.'
            );

            return;
        }


        if (!channel.isTextBased()) {

            console.error(
                '❌ WELCOME_CHANNEL_ID is not a text channel.'
            );

            return;
        }


        const messages =
            await channel.messages.fetch({
                limit: 100
            });


        const existingPanels =
            messages.filter(message => {

                if (
                    message.author.id !==
                    client.user.id
                ) {

                    return false;
                }


                return message.components.some(row =>
                    row.components.some(
                        component =>
                            component.customId ===
                            'register_button'
                    )
                );
            });


        // ---------------------------------------------
        // DELETE DUPLICATES
        // ---------------------------------------------

        if (existingPanels.size > 1) {

            console.log(
                `⚠️ Found ${existingPanels.size} welcome panels. Cleaning duplicates...`
            );


            const panels =
                [...existingPanels.values()]
                    .sort(
                        (a, b) =>
                            b.createdTimestamp -
                            a.createdTimestamp
                    );


            for (
                const oldPanel of panels.slice(1)
            ) {

                try {

                    await oldPanel.delete();

                    console.log(
                        `🗑️ Deleted duplicate welcome panel: ${oldPanel.id}`
                    );

                } catch (error) {

                    console.error(
                        `❌ Could not delete duplicate panel ${oldPanel.id}:`,
                        error.message
                    );
                }
            }


            console.log(
                `✅ Kept newest welcome panel: ${panels[0].id}`
            );

            return;
        }


        // ---------------------------------------------
        // ALREADY EXISTS
        // ---------------------------------------------

        if (existingPanels.size === 1) {

            console.log(
                '✅ Exactly one welcome panel exists. No new panel created.'
            );

            return;
        }


        // ---------------------------------------------
        // CREATE REGISTER BUTTON
        // ---------------------------------------------

        const registerButton =
            new ButtonBuilder()
                .setCustomId(
                    'register_button'
                )
                .setLabel(
                    '📝 Register'
                )
                .setStyle(
                    ButtonStyle.Primary
                );


        const row =
            new ActionRowBuilder()
                .addComponents(
                    registerButton
                );


        await channel.send({

            content:
                '## 👋 Welcome to FUN FUN!\n\n' +

                'Welcome to the server!\n' +

                'Before entering the community, please register your in-game name and birthday below. Your birthday is stored as month/day only (no birth year) and used for a birthday greeting.\n\n' +

                '🎮 **In-game name**\n' +

                'Your in-game name will become your **server nickname**.\n\n' +

                '📝 Click **Register** to get started.\n\n' +

                '━━━━━━━━━━━━━━━━━━━━\n\n' +

                '🔐 **Registration is required to access the community.**',

            components: [
                row
            ]
        });


        console.log(
            '📝 Welcome panel created automatically.'
        );


    } catch (error) {

        console.error(
            '❌ Failed to create/check welcome panel:'
        );

        console.error(error);
    }
}


// =====================================================
// ROLE SELECTION PANEL
// =====================================================

async function ensureRolePanel() {

    try {

        const roleChannelId =
            process.env.ROLE_CHANNEL_ID;


        console.log(
            '🎮 Role channel ID:',
            roleChannelId
        );


        if (!roleChannelId) {

            console.error(
                '❌ ROLE_CHANNEL_ID is undefined!'
            );

            return;
        }


        const channel =
            await client.channels.fetch(
                roleChannelId
            );


        if (!channel) {

            console.error(
                '❌ Role channel could not be found.'
            );

            return;
        }


        if (!channel.isTextBased()) {

            console.error(
                '❌ ROLE_CHANNEL_ID is not a text channel.'
            );

            return;
        }


        const messages =
            await channel.messages.fetch({
                limit: 100
            });


        // ---------------------------------------------
        // FIND OLD / EXISTING ROLE PANEL
        // ---------------------------------------------

        const existingPanels =
            messages.filter(message => {

                if (
                    message.author.id !==
                    client.user.id
                ) {

                    return false;
                }


                return message.components.some(row =>
                    row.components.some(
                        component =>
                            component.customId &&
                            component.customId ===
                            'role_selector'
                    )
                );
            });


        // ---------------------------------------------
        // DELETE DUPLICATES
        // ---------------------------------------------

        if (existingPanels.size > 1) {

            console.log(
                `⚠️ Found ${existingPanels.size} role panels. Cleaning duplicates...`
            );


            const panels =
                [...existingPanels.values()]
                    .sort(
                        (a, b) =>
                            b.createdTimestamp -
                            a.createdTimestamp
                    );


            for (
                const oldPanel of panels.slice(1)
            ) {

                try {

                    await oldPanel.delete();

                    console.log(
                        `🗑️ Deleted duplicate role panel: ${oldPanel.id}`
                    );

                } catch (error) {

                    console.error(
                        `❌ Could not delete duplicate role panel ${oldPanel.id}:`,
                        error.message
                    );
                }
            }


            console.log(
                `✅ Kept newest role panel: ${panels[0].id}`
            );

            return;
        }


        // ---------------------------------------------
        // PANEL ALREADY EXISTS
        // ---------------------------------------------

        if (existingPanels.size === 1) {

            console.log(
                '✅ Role selection panel already exists.'
            );

            return;
        }


        // ---------------------------------------------
        // CREATE MULTI-SELECT MENU
        // ---------------------------------------------

        const roleMenu =
            new StringSelectMenuBuilder()
                .setCustomId(
                    'role_selector'
                )
                .setPlaceholder(
                    '🎮 Select your roles'
                )
                .setMinValues(
                    0
                )
                .setMaxValues(
                    selectableRoles.length
                )
                .addOptions(

                    {
                        label: 'Hero Realms',
                        description: 'Choose Hero Realms',
                        value: 'Hero Realms',
                        emoji: '⚔️'
                    },

                    {
                        label: 'Sword Trials',
                        description: 'Choose Sword Trials',
                        value: 'Sword Trials',
                        emoji: '🗡️'
                    },

                    {
                        label: 'Talents',
                        description: 'Choose Talents',
                        value: 'Talents',
                        emoji: '✨'
                    },

                    {
                        label: 'Speed Run',
                        description: 'Choose Speed Run',
                        value: 'Speed Run',
                        emoji: '⏱️'
                    },

                    {
                        label: 'Perception Forest',
                        description: 'Choose Perception Forest',
                        value: 'Perception Forest',
                        emoji: '🌲'
                    }
                );


        const row =
            new ActionRowBuilder()
                .addComponents(
                    roleMenu
                );


        // ---------------------------------------------
        // SEND PANEL
        // ---------------------------------------------

        await channel.send({

            content:
                '## 🎮 Choose Your Roles\n\n' +

                'Choose the activities you are interested in.\n\n' +

                'Use the menu below to select your roles.\n' +

                'You can choose **one or multiple roles**.\n\n' +

                '### Available Roles\n\n' +

                '⚔️ **Hero Realms**\n' +

                '🗡️ **Sword Trials**\n' +

                '✨ **Talents**\n' +

                '⏱️ **Speed Run**\n' +

                '🌲 **Perception Forest**\n\n' +

                '━━━━━━━━━━━━━━━━━━━━\n\n' +

                '🎮 You can change your selections at any time.',

            components: [
                row
            ]
        });


        console.log(
            '🎮 Role selection panel created automatically.'
        );


    } catch (error) {

        console.error(
            '❌ Failed to create/check role panel:'
        );

        console.error(error);
    }
}


// =====================================================
// BOT READY
// =====================================================

client.once(
    Events.ClientReady,
    async readyClient => {

        console.log(
            `🦇 ${readyClient.user.username} is online!`
        );


        // ---------------------------------------------
        // REGISTER COMMANDS
        // ---------------------------------------------

        try {

            await rest.put(
                Routes.applicationGuildCommands(
                    readyClient.user.id,
                    process.env.GUILD_ID
                ),
                {
                    body: commands
                }
            );


            console.log(
                `✅ ${commands.length} command(s) registered!`
            );


        } catch (error) {

            console.error(
                '❌ Command registration failed:'
            );

            console.error(error);
        }


        // ---------------------------------------------
        // PANELS
        // ---------------------------------------------

        await loadStoredData();
        await ensureWelcomePanel();
        await ensureRolePanel();

        // Check once a minute. Birthday greetings are sent only at 09:00
        // Asia/Ho_Chi_Minh; no startup or late catch-up greetings.
        setInterval(() => {
            void checkBirthdays();
        }, 60_000);
    }
);


// =====================================================
// INTERACTIONS
// =====================================================

client.on(
    Events.InteractionCreate,
    async interaction => {


        // =================================================
        // SLASH COMMAND
        // =================================================

        if (
            interaction.isChatInputCommand()
        ) {

            if (interaction.commandName === 'ping') {
                await interaction.reply('🦇 Pong!');
                return;
            }

            if (interaction.commandName === 'voice') {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === 'join') {
                    await connectTTS(interaction);
                    return;
                }

                if (subcommand === 'leave') {
                    if (voiceSession?.connection) voiceSession.connection.destroy();
                    voiceSession = null;
                    speechQueue.length = 0;
                    await interaction.reply({ content: '🦇 BatCat left voice chat and cleared the speech queue.', ephemeral: true });
                    return;
                }

                if (subcommand === 'on') {
                    // /voice on now automatically joins the VC you're currently in.
                    await connectTTS(interaction);
                    return;
                }

                if (subcommand === 'off') {
                    ttsEnabled = false;
                    speechQueue.length = 0;
                    voicePlayer.stop(true);
                    await interaction.reply({ content: '🔇 Automatic message reading is paused. Use `/voice on` to resume.', ephemeral: true });
                    return;
                }
            }

            if (interaction.commandName === 'birthday') {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === 'set') {
                    const month = interaction.options.getInteger('month');
                    const day = interaction.options.getInteger('day');
                    const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();

                    if (day > daysInMonth) {
                        await interaction.reply({ content: '⚠️ That date is not valid. Please check the month and day.', ephemeral: true });
                        return;
                    }

                    storedData.birthdays[interaction.user.id] = { month, day };
                    await saveStoredData();
                    await interaction.reply({
                        content: `🎂 Your birthday is saved privately as **${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}**. No birth year is stored.`,
                        ephemeral: true
                    });
                    return;
                }
            }
        }


        // =================================================
        // BUTTONS
        // =================================================

        if (
            interaction.isButton()
        ) {


            // ---------------------------------------------
            // REGISTER
            // ---------------------------------------------

            if (
                interaction.customId ===
                'register_button'
            ) {

                const memberRole =
                    findRoleByName(
                        interaction.guild,
                        memberRoleName
                    );


                if (!memberRole) {

                    await interaction.reply({

                        content:
                            '⚠️ The `Fancy Members` role does not exist.\n\n' +
                            'Please create a role named **Fancy Members**.',

                        ephemeral: true
                    });

                    return;
                }


                if (
                    interaction.member.roles.cache.has(
                        memberRole.id
                    )
                ) {

                    await interaction.reply({

                        content:
                            '✅ **You are already registered!**\n\n' +
                            `Your current server nickname is **${interaction.member.displayName}**.`,

                        ephemeral: true
                    });

                    return;
                }


                // -----------------------------------------
                // REGISTRATION MODAL
                // -----------------------------------------

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            'registration_modal'
                        )
                        .setTitle(
                            'Server Registration'
                        );


                const ignInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'ign'
                        )
                        .setLabel(
                            'In-game Name'
                        )
                        .setPlaceholder(
                            'Enter your in-game name'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(
                            true
                        )
                        .setMinLength(
                            1
                        )
                        .setMaxLength(
                            32
                        );


                const birthdayInput =
                    new TextInputBuilder()
                        .setCustomId('birthday')
                        .setLabel('Birthday (MM/DD, no year)')
                        .setPlaceholder('Example: 07/24')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(5);

                const ignRow = new ActionRowBuilder().addComponents(ignInput);
                const birthdayRow = new ActionRowBuilder().addComponents(birthdayInput);

                modal.addComponents(ignRow, birthdayRow);


                await interaction.showModal(
                    modal
                );

                return;
            }
        }


        // =================================================
        // ROLE SELECT MENU
        // =================================================

        if (
            interaction.isStringSelectMenu()
        ) {

            if (
                interaction.customId !==
                'role_selector'
            ) {

                return;
            }


            // ---------------------------------------------
            // CHECK FANCY MEMBERS
            // ---------------------------------------------

            const memberRole =
                findRoleByName(
                    interaction.guild,
                    memberRoleName
                );


            if (!memberRole) {

                await interaction.reply({

                    content:
                        '⚠️ The `Fancy Members` role does not exist.',

                    ephemeral: true
                });

                return;
            }


            if (
                !interaction.member.roles.cache.has(
                    memberRole.id
                )
            ) {

                await interaction.reply({

                    content:
                        '🔒 **You need to register first.**\n\n' +
                        'Please complete registration in the welcome channel.',

                    ephemeral: true
                });

                return;
            }


            // ---------------------------------------------
            // DEFER IMMEDIATELY
            // ---------------------------------------------
            // This prevents slow Discord/API responses
            // from causing the interaction to expire.

            await interaction.deferReply({
                ephemeral: true
            });


            try {

                const selectedRoleNames =
                    interaction.values;


                // -----------------------------------------
                // GET CURRENT SELECTABLE ROLES
                // -----------------------------------------

                const currentRoles =
                    interaction.member.roles.cache.filter(
                        role =>
                            selectableRoles.includes(
                                role.name
                            )
                    );


                // -----------------------------------------
                // REMOVE ROLES NOT SELECTED
                // -----------------------------------------

                for (
                    const role of currentRoles.values()
                ) {

                    if (
                        !selectedRoleNames.includes(
                            role.name
                        )
                    ) {

                        try {

                            await interaction.member.roles.remove(
                                role
                            );

                        } catch (error) {

                            console.error(
                                `❌ Could not remove ${role.name}:`,
                                error.message
                            );
                        }
                    }
                }


                // -----------------------------------------
                // ADD SELECTED ROLES
                // -----------------------------------------

                const addedRoles = [];


                for (
                    const roleName of selectedRoleNames
                ) {

                    const selectedRole =
                        findRoleByName(
                            interaction.guild,
                            roleName
                        );


                    if (!selectedRole) {

                        continue;
                    }


                    if (
                        !interaction.member.roles.cache.has(
                            selectedRole.id
                        )
                    ) {

                        try {

                            await interaction.member.roles.add(
                                selectedRole
                            );

                            addedRoles.push(
                                roleName
                            );

                        } catch (error) {

                            console.error(
                                `❌ Could not add ${roleName}:`,
                                error.message
                            );
                        }
                    }
                }


                // -----------------------------------------
                // FINAL ROLE LIST
                // -----------------------------------------

                const finalRoles =
                    interaction.member.roles.cache
                        .filter(
                            role =>
                                selectableRoles.includes(
                                    role.name
                                )
                        )
                        .map(
                            role =>
                                role.name
                        );


                if (
                    finalRoles.length === 0
                ) {

                    await interaction.editReply({

                        content:
                            '✅ Your role selections have been cleared.'
                    });

                } else {

                    await interaction.editReply({

                        content:
                            '✅ **Your roles have been updated!**\n\n' +
                            finalRoles
                                .map(
                                    role =>
                                        `• **${role}**`
                                )
                                .join('\n')
                    });
                }


                console.log(
                    `🎮 ${interaction.user.tag} selected roles:`,
                    finalRoles
                );


            } catch (error) {

                console.error(
                    '❌ ROLE SELECT ERROR:',
                    error
                );


                await interaction.editReply({

                    content:
                        '⚠️ I could not update your roles.\n\n' +
                        'Make sure all selectable roles are **below BatCat** in the server role hierarchy.'
                });
            }


            return;
        }


        // =================================================
        // REGISTRATION MODAL
        // =================================================

        if (
            interaction.isModalSubmit()
        ) {

            if (
                interaction.customId !==
                'registration_modal'
            ) {

                return;
            }


            const ign =
                interaction.fields
                    .getTextInputValue('ign')
                    .trim();

            const birthdayText =
                interaction.fields.getTextInputValue('birthday').trim();
            const birthday = parseBirthday(birthdayText);

            if (!birthday) {
                await interaction.reply({
                    content: '⚠️ Please enter a valid birthday in **MM/DD** format, such as `07/24`. The year is not collected.',
                    ephemeral: true
                });
                return;
            }

            const memberRole =
                findRoleByName(
                    interaction.guild,
                    memberRoleName
                );


            // ---------------------------------------------
            // CHECK FANCY MEMBERS
            // ---------------------------------------------

            if (!memberRole) {

                await interaction.reply({

                    content:
                        '⚠️ The `Fancy Members` role does not exist.\n\n' +
                        'Please contact a moderator.',

                    ephemeral: true
                });S

                return;
            }


            // ---------------------------------------------
            // ALREADY REGISTERED
            // ---------------------------------------------

            if (
                interaction.member.roles.cache.has(
                    memberRole.id
                )
            ) {

                await interaction.reply({

                    content:
                        '✅ **You are already registered!**',

                    ephemeral: true
                });

                return;
            }


            // ---------------------------------------------
            // REGISTRATION
            // ---------------------------------------------

            try {

                let nicknameChanged =
                    false;


                // -----------------------------------------
                // CHANGE NICKNAME
                // -----------------------------------------

                try {

                    if (
                        interaction.member.manageable
                    ) {

                        await interaction.member.setNickname(
                            ign
                        );

                        nicknameChanged =
                            true;


                        console.log(
                            `✏️ Nickname changed: ${interaction.user.tag} → ${ign}`
                        );

                    } else {

                        console.log(
                            `ℹ️ Cannot change nickname of ${interaction.user.tag} because their role is above BatCat.`
                        );
                    }

                } catch (
                    nicknameError
                ) {

                    console.log(
                        `ℹ️ Nickname could not be changed for ${interaction.user.tag}:`,
                        nicknameError.message
                    );
                }


                // -----------------------------------------
                // GIVE FANCY MEMBERS
                // -----------------------------------------

                await interaction.member.roles.add(memberRole);

                storedData.birthdays[interaction.user.id] = birthday;
                await saveStoredData();

                console.log(
                    `✅ Fancy Members role given to ${interaction.user.tag}; birthday saved as ${String(birthday.month).padStart(2, '0')}/${String(birthday.day).padStart(2, '0')}`
                );


                // -----------------------------------------
                // CONFIRMATION
                // -----------------------------------------

                if (
                    nicknameChanged
                ) {

                    await interaction.reply({

                        content:
                            '🎉 **Registration complete!**\n\n' +

                            `🎮 **In-game name:** ${ign}\n` +
                            `🎂 **Birthday:** ${String(birthday.month).padStart(2, '0')}/${String(birthday.day).padStart(2, '0')} (month/day only)\n\n` +

                            `✏️ Your server nickname is now **${ign}**.\n\n` +

                            '🔓 **Access granted!**\n\n' +

                            'Welcome to FUN FUN! Have fun!',

                        ephemeral: true
                    });

                } else {

                    await interaction.reply({

                        content:
                            '🎉 **Registration complete!**\n\n' +

                            `🎮 **In-game name:** ${ign}\n` +
                            `🎂 **Birthday:** ${String(birthday.month).padStart(2, '0')}/${String(birthday.day).padStart(2, '0')} (month/day only)\n\n` +

                            '🔓 **Access granted!**\n\n' +

                            'Your **Fancy Members** role has been added.\n\n' +

                            'Your server nickname could not be changed because your role is higher than BatCat.',

                        ephemeral: true
                    });
                }


                console.log(
                    `🎉 Registration complete: ${interaction.user.tag} → ${ign}`
                );


            } catch (error) {

                console.error(
                    '❌ REGISTRATION ERROR'
                );

                console.error(
                    'Error code:',
                    error.code
                );

                console.error(
                    'Error message:',
                    error.message
                );

                console.error(
                    error
                );


                if (
                    !interaction.replied
                ) {

                    await interaction.reply({

                        content:
                            '⚠️ **Registration failed.**\n\n' +
                            `Discord error: \`${error.message}\`\n\n` +
                            'Please contact a moderator.',

                        ephemeral: true
                    });
                }
            }
        }
    }
);


// =====================================================
// AUTOMATIC TTS MESSAGE LISTENER
// =====================================================

client.on(Events.MessageCreate, message => {
    enqueueMessageForTTS(message);
});


// =====================================================
// LOGIN
// =====================================================

client.login(
    process.env.DISCORD_TOKEN
);
