const t = (artist, title, query = null) => ({ artist, title, query });
const cover = (artist, title) => t(artist, `${title} (lo-fi)`, `${title} ${artist} lofi`);

module.exports = {
    study: {
        name: 'Lo-fi Study',
        emoji: '📚',
        vibe: 'Classic lo-fi hip hop beats to study or relax to.',
        tracks: [
            t('Jinsang', 'Affection'), t('tomppabeats', 'Monday Loop'), t('Idealism', 'Controlla'),
            t('Kudasai', "The Girl I Haven't Met"), t('Jhfly', 'Sheets'), t('potsu', "i'm closing my eyes"),
            t('In Love With a Ghost', "We've Never Met but Can We Have a Coffee or Something"), t('Kina', 'Get You The Moon'),
            t('Saib', 'Sakura Trees'), t('Kupla', 'Owls of the Night'), t('Mndsgn', 'Camelblues'),
            t('Idealism', 'phosphene'), t('Jinsang', 'Solitude'), t('tomppabeats', "you're in love"),
            t('Idealism', 'hikikomori'), t('Powfu', 'death bed (coffee for your head)'), t('Mounika.', 'Cut My Hair'),
            t('J Dilla', "Don't Cry"), t('J Dilla', 'Time: The Donut of the Heart'), t('J Dilla', 'Last Donut of the Night'),
            t('Emancipator', 'Soon It Will Be Cold Enough to Build Fires'), t('Emancipator', 'Greenland'),
            t('Bonobo', 'Kerala'), t('Bonobo', 'Cirrus'), t('DJ Okawari', 'Flower Dance'), t('DJ Okawari', 'Luv Letter'),
        ],
    },
    nujabes: {
        name: 'Nujabes & Jazzy Beats',
        emoji: '🎷',
        vibe: 'The jazzy hip hop that started it all.',
        tracks: [
            t('Nujabes', 'Aruarian Dance'), t('Nujabes', 'Feather'), t('Nujabes', 'Luv(sic) pt3'),
            t('Nujabes', 'Reflection Eternal'), t('Nujabes', 'Counting Stars'), t('Nujabes', 'Battlecry'),
            t('Nujabes', 'Spiral'), t('Nujabes', 'The Final View'), t('Nujabes', 'Lady Brown'),
            t('Nujabes', 'Modal Soul'), t('Nujabes', 'Horizon'), t('Nujabes', 'Kumomi'),
            t('Nujabes', 'Imaginary Folklore'), t('Nujabes', 'Sky Is Tumbling'), t('Nujabes', 'After Hanabi -listen to my beats-'),
            t('Nujabes', 'Letter from Yokosuka'), t('Nujabes', 'Ordinary Joe'), t('Nujabes', 'Beat Laments the World'),
            t('Nujabes', "World's End Rhapsody"), t('MINMI', 'Shiki no Uta'), t('Uyama Hiroto', 'Waltz for Life Will Born'),
            t('Uyama Hiroto', 'One Dream'), t('J Dilla', 'So Far to Go'), t('J Dilla', 'Two Can Win'),
        ],
    },
    ghibli: {
        name: 'Ghibli Lo-fi',
        emoji: '🍃',
        vibe: 'Studio Ghibli songs as soft lo-fi covers.',
        tracks: [
            cover('Joe Hisaishi', "One Summer's Day"), cover('Joe Hisaishi', 'Merry-Go-Round of Life'), cover('Joe Hisaishi', 'Path of the Wind'),
            cover('Youmi Kimura', 'Always With Me'), cover('Joe Hisaishi', 'The Sixth Station'), cover('Joe Hisaishi', 'A Town with an Ocean View'),
            cover('Joe Hisaishi', 'Princess Mononoke'), cover('Joe Hisaishi', 'Carrying You'), cover('Joe Hisaishi', 'My Neighbor Totoro'),
            cover('Joe Hisaishi', 'Summer'), cover('Joe Hisaishi', 'Kimi wo Nosete'), cover('Cécile Corbel', "Arrietty's Song"),
            cover('Whisper of the Heart', 'Country Roads'), cover('Joe Hisaishi', 'Bygone Days'), cover('Joe Hisaishi', 'Nausicaa Requiem'),
            cover('Joe Hisaishi', 'The Legend of Ashitaka'), cover('Joe Hisaishi', "Howl's Moving Castle"), cover('Joe Hisaishi', 'Ponyo on the Cliff by the Sea'),
            cover('Joe Hisaishi', 'Reprise Spirited Away'), cover('Joe Hisaishi', 'Stroll'), cover('Joe Hisaishi', 'The Name of Life'),
            cover('Yumi Arai', 'Rouge no Dengon'), cover('Yumi Arai', 'Yasashisa ni Tsutsumareta nara'), cover('Yumi Arai', 'Hikoki Gumo'),
            cover('Kazumi Nikaido', 'Inochi no Kioku'),
        ],
    },
    anime: {
        name: 'Anime Lo-fi',
        emoji: '🌙',
        vibe: 'Anime openings and endings, slowed down and chilled out.',
        tracks: [
            cover('TK', 'Unravel'), cover('Ikimonogakari', 'Blue Bird'), cover('KANA-BOON', 'Silhouette'),
            cover('LiSA', 'Gurenge'), cover('Eve', 'Kaikai Kitan'), cover('RADWIMPS', 'Sparkle'),
            cover('RADWIMPS', 'Nandemonaiya'), cover('RADWIMPS', 'Zenzenzense'), cover('RADWIMPS', 'Grand Escape'),
            cover('Linked Horizon', 'Shinzou wo Sasageyo'), cover('YUI', 'Again'), cover('Goose house', 'Hikaru Nara'),
            cover('Minami', 'Kawaki wo Ameku'), cover('Elfen Lied', 'Lilium'), cover('Kana Hanazawa', 'Renai Circulation'),
            cover('EGOIST', 'Departures'), cover('YOASOBI', 'Yoru ni Kakeru'), cover('Evangelion', 'Fly Me to the Moon'),
            cover('Sukima Switch', 'Golden Time Lover'), cover('Judy and Mary', 'Sobakasu'), cover('Kenshi Yonezu', 'Peace Sign'),
            cover('Kenshi Yonezu', 'Kick Back'), cover('Official HIGE DANdism', 'Mixed Nuts'), cover('Clannad', 'Dango Daikazoku'),
            cover('Aimer', 'Brave Shine'), cover('Aimer', 'Kataomoi'), cover('Aimer', 'Ref:rain'),
            cover('Kenshi Yonezu', 'Lemon'), cover('DAOKO', 'Uchiage Hanabi'), cover('supercell', 'Kimi no Shiranai Monogatari'),
        ],
    },
};
