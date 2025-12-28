(async () => {
    // Simple test harness for sendBugReport
    const path = require('path');
    // ensure we load the module from card-bot
    const bot = require(path.resolve(__dirname, '..', 'card-bot', 'index.js'));

    // Mock interaction
    function makeInteraction(desc, img) {
        return {
            deferred: false,
            replied: false,
            options: {
                getString: (name, required) => {
                    if (name === 'description') return desc;
                    if (name === 'image_url') return img;
                    return null;
                }
            },
            user: { id: '12345', tag: 'tester#0001' },
            deferReply: async (opts) => {
                console.log('[interaction.deferReply] opts=', opts);
                this.deferred = true; // no-op for mock
                return;
            },
            editReply: async (payload) => {
                console.log('[interaction.editReply] payload=', payload);
                return { ok: true };
            },
            reply: async (payload) => {
                console.log('[interaction.reply] payload=', payload);
                return { ok: true };
            }
        };
    }

    // Mock client whose channels.fetch returns a channel with a send method
    const mockChannel = {
        send: async (payload) => {
            console.log('[mockChannel.send] payload=', JSON.stringify(payload, null, 2));
            return { ok: true };
        }
    };

    const mockClient = {
        channels: {
            fetch: async (id) => {
                console.log('[mockClient.channels.fetch] id=', id);
                if (!id) throw new Error('no id');
                return mockChannel;
            }
        }
    };

    console.log('--- TEST 1: success path ---');
    process.env.BUG_CHANNEL_ID = 'fake-channel-id-1';
    const inter1 = makeInteraction('Test bug description', 'https://example.com/image.png');
    const res1 = await bot.sendBugReport(mockClient, inter1);
    console.log('result:', res1);

    console.log('\n--- TEST 2: missing BUG_CHANNEL_ID ---');
    delete process.env.BUG_CHANNEL_ID;
    const inter2 = makeInteraction('Test when missing channel', null);
    const res2 = await bot.sendBugReport(mockClient, inter2);
    console.log('result:', res2);

    console.log('\n--- TEST 3: channel.fetch throws ---');
    process.env.BUG_CHANNEL_ID = 'will-throw';
    const errorClient = {
        channels: {
            fetch: async (id) => { throw new Error('fetch failed'); }
        }
    };
    const inter3 = makeInteraction('This should fail to send', null);
    const res3 = await bot.sendBugReport(errorClient, inter3);
    console.log('result:', res3);

    process.exit(0);
})();
