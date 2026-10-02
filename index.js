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


// =====================================================
// CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});


// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check if BatCat is working.')
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

                'Before entering the community, please register your in-game name below.\n\n' +

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

        await ensureWelcomePanel();

        await ensureRolePanel();
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

            if (
                interaction.commandName ===
                'ping'
            ) {

                await interaction.reply(
                    '🦇 Pong!'
                );

                return;
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


                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            ignInput
                        );


                modal.addComponents(
                    row
                );


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
                    .getTextInputValue(
                        'ign'
                    )
                    .trim();


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
                });

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

                await interaction.member.roles.add(
                    memberRole
                );


                console.log(
                    `✅ Fancy Members role given to ${interaction.user.tag}`
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

                            `🎮 **In-game name:** ${ign}\n\n` +

                            `✏️ Your server nickname is now **${ign}**.\n\n` +

                            '🔓 **Access granted!**\n\n' +

                            'Welcome to FUN FUN! Have fun!',

                        ephemeral: true
                    });

                } else {

                    await interaction.reply({

                        content:
                            '🎉 **Registration complete!**\n\n' +

                            `🎮 **In-game name:** ${ign}\n\n` +

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
// LOGIN
// =====================================================

client.login(
    process.env.DISCORD_TOKEN
);