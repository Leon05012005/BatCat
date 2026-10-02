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
    TextInputStyle
} from 'discord.js';


// ==========================================
// CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});


// ==========================================
// SLASH COMMANDS
// ==========================================

const commands = [

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check if BatCat is working.')

].map(command => command.toJSON());


// ==========================================
// DISCORD REST
// ==========================================

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);


// ==========================================
// WELCOME PANEL
// ==========================================

async function ensureWelcomePanel() {

    try {

        // Get the welcome channel
        const channel =
            await client.channels.fetch(
                process.env.WELCOME_CHANNEL_ID
            );


        if (!channel) {

            console.error(
                '❌ Welcome channel could not be found.'
            );

            return;
        }


        // Make sure this is a text-based channel
        if (!channel.isTextBased()) {

            console.error(
                '❌ WELCOME_CHANNEL_ID is not a text channel.'
            );

            return;
        }


        // ==========================================
        // CHECK FOR EXISTING PANEL
        // ==========================================

        const messages =
            await channel.messages.fetch({
                limit: 100
            });


        const existingPanels =
            messages.filter(message => {

                // Only look at messages sent by BatCat
                if (
                    message.author.id !==
                    client.user.id
                ) {
                    return false;
                }


                // Look for our registration button
                return message.components.some(row =>
                    row.components.some(
                        component =>
                            component.customId ===
                            'register_button'
                    )
                );

            });


        // ==========================================
        // PANEL ALREADY EXISTS
        // ==========================================

        if (existingPanels.size > 0) {

            console.log(
                '✅ Welcome panel already exists. No new panel created.'
            );

            return;
        }


        // ==========================================
        // CREATE REGISTER BUTTON
        // ==========================================

        const registerButton =
            new ButtonBuilder()
                .setCustomId('register_button')
                .setLabel('📝 Register')
                .setStyle(ButtonStyle.Primary);


        const row =
            new ActionRowBuilder()
                .addComponents(registerButton);


        // ==========================================
        // SEND WELCOME PANEL
        // ==========================================

        await channel.send({

            content:

                '## 👋 Welcome to FUN FUN!\n\n' +

                'Welcome to the server!\n' +
                'Before entering the community, please register your in-game name below.\n\n' +

                '🎮 **In-game name**\n' +
                'Your in-game name will become your **server nickname**.\n\n' +

                '📝 Click **Register** to get started.\n\n' +

                '━━━━━━━━━━━━━━━━━━━━\n\n' +

                '🔐 **Registration is required to access the community.**',

            components: [row]

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


// ==========================================
// BOT READY
// ==========================================

client.once(
    Events.ClientReady,
    async readyClient => {

        console.log(
            `🦇 ${readyClient.user.username} is online!`
        );


        // Register slash commands
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


        // ==========================================
        // AUTOMATIC WELCOME PANEL
        // ==========================================

        await ensureWelcomePanel();

    }
);


// ==========================================
// INTERACTIONS
// ==========================================

client.on(
    Events.InteractionCreate,
    async interaction => {


        // ==========================================
        // SLASH COMMANDS
        // ==========================================

        if (interaction.isChatInputCommand()) {


            // ------------------------------
            // /ping
            // ------------------------------

            if (
                interaction.commandName === 'ping'
            ) {

                await interaction.reply(
                    '🦇 Pong!'
                );

                return;
            }

        }


        // ==========================================
        // REGISTER BUTTON
        // ==========================================

        if (interaction.isButton()) {


            if (
                interaction.customId ===
                'register_button'
            ) {


                // Find Verified role
                const verifiedRole =
                    interaction.guild.roles.cache.find(
                        role =>
                            role.name === 'Verified'
                    );


                if (!verifiedRole) {

                    await interaction.reply({

                        content:
                            '⚠️ The `Verified` role does not exist.\n\n' +
                            'Please create a role named **Verified**.',

                        ephemeral: true

                    });

                    return;
                }


                // Already registered?
                if (
                    interaction.member.roles.cache.has(
                        verifiedRole.id
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


                // ==========================================
                // REGISTRATION MODAL
                // ==========================================

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
                        .setCustomId('ign')
                        .setLabel(
                            'In-game Name'
                        )
                        .setPlaceholder(
                            'Enter your in-game name'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(32);


                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            ignInput
                        );


                modal.addComponents(row);


                await interaction.showModal(
                    modal
                );

                return;
            }

        }


        // ==========================================
        // REGISTRATION FORM
        // ==========================================

        if (interaction.isModalSubmit()) {


            if (
                interaction.customId ===
                'registration_modal'
            ) {


                const ign =
                    interaction.fields
                        .getTextInputValue('ign')
                        .trim();


                // Find Verified role
                const verifiedRole =
                    interaction.guild.roles.cache.find(
                        role =>
                            role.name === 'Verified'
                    );


                if (!verifiedRole) {

                    await interaction.reply({

                        content:
                            '⚠️ The `Verified` role does not exist.\n\n' +
                            'Please contact a moderator.',

                        ephemeral: true

                    });

                    return;
                }


                // Check again
                if (
                    interaction.member.roles.cache.has(
                        verifiedRole.id
                    )
                ) {

                    await interaction.reply({

                        content:
                            '✅ **You are already registered!**',

                        ephemeral: true

                    });

                    return;
                }


                try {


                    // ==========================================
                    // CHANGE NICKNAME
                    // ==========================================

                    await interaction.member.setNickname(
                        ign
                    );


                    console.log(
                        `✏️ Nickname changed: ${interaction.user.tag} → ${ign}`
                    );


                    // ==========================================
                    // GIVE VERIFIED ROLE
                    // ==========================================

                    await interaction.member.roles.add(
                        verifiedRole
                    );


                    console.log(
                        `✅ Verified role given to ${interaction.user.tag}`
                    );


                    // ==========================================
                    // CONFIRMATION
                    // ==========================================

                    await interaction.reply({

                        content:

                            '🎉 **Registration complete!**\n\n' +

                            `🎮 **In-game name:** ${ign}\n\n` +

                            `✏️ Your server nickname is now **${ign}**.\n\n` +

                            '🔓 **Access granted!**\n' +
                            'Welcome to FUN FUN! Have fun!',

                        ephemeral: true

                    });


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

                    console.error(error);


                    if (!interaction.replied) {

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

    }
);


// ==========================================
// LOGIN
// ==========================================

client.login(
    process.env.DISCORD_TOKEN
);