import axios from 'axios';
import cheerio from 'cheerio';
import { URL } from 'url';
import { MongoClient } from 'mongodb';
import mime from 'mime-types';
import path from 'path';

class SimpleWebCrawler {
    constructor(baseUrls) {
        this.baseUrls = baseUrls;
        this.visitedUrls = new Set();
        this.failedUrls = new Set(); // Ensemble pour stocker les URLs qui ont échoué
        this.urlQueue = [...baseUrls];

        // Configurer la connexion à MongoDB
        const uri = "mongodb+srv://kalisearch:12RJKw75ElO8dTUd@cluster0.z8zdf0m.mongodb.net/";
        this.client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        this.db = null;
        this.collection = null;
    }

    async init() {
        try {
            await this.client.connect();
            this.db = this.client.db('kali_search'); // Nom de la base de données
            this.collection = this.db.collection('web_data'); // Nom de la collection

            // Test de connexion MongoDB
            await this.collection.insertOne({ test: 'Connexion établie' });
            console.log("Connexion MongoDB établie.");
        } catch (error) {
            console.error("Erreur de connexion à MongoDB:", error);
        }
    }

    async fetchPage(url) {
        try {
            const response = await axios.get(url);
            return { data: response.data, contentType: response.headers['content-type'] };
        } catch (error) {
            console.error(`Échec de la récupération de ${url}:`, error);
            return { data: null, contentType: null };
        }
    }

    parseLinks(html, baseUrl) {
        const $ = cheerio.load(html);
        const links = new Set();
        $('a[href]').each((index, element) => {
            let href = $(element).attr('href');
            if (!href.includes('#')) {  // Filtrer les liens avec des fragments
                const fullUrl = new URL(href, baseUrl).href;
                links.add(fullUrl);  // Ajouter tous les liens, internes et externes
            }
        });
        return links;
    }

    containsSignificantJavaScript(html) {
        const $ = cheerio.load(html);
        let containsJavaScript = false;
        $('script').each((index, element) => {
            const scriptContent = $(element).html();
            if (scriptContent && /window\.location|document\.cookie|setTimeout|setInterval|fetch|XMLHttpRequest/.test(scriptContent)) {
                containsJavaScript = true;
                return false; // arrêter la boucle
            }
        });
        return containsJavaScript;
    }

    extractText(html) {
        const $ = cheerio.load(html);
        return $('body').text().trim().replace(/\s+/g, ' ');
    }

    async crawl() {
        while (this.urlQueue.length > 0) {
            const currentUrl = this.urlQueue.shift();
            if (!this.visitedUrls.has(currentUrl) && !this.failedUrls.has(currentUrl)) {
                console.log(`Visite de : ${currentUrl}`);
                const { data, contentType } = await this.fetchPage(currentUrl);
                if (data) {
                    if (this.containsSignificantJavaScript(data)) {
                        console.log(`Ignoré ${currentUrl} en raison du contenu JavaScript significatif.`);
                        continue;
                    }

                    this.visitedUrls.add(currentUrl);
                    const links = this.parseLinks(data, currentUrl);
                    let content;

                    if (contentType) {
                        const mimeType = mime.lookup(currentUrl);
                        if (mimeType && (mimeType.startsWith('image') || mimeType.startsWith('text'))) {
                            const fileName = path.basename(new URL(currentUrl).pathname);
                            content = fileName;
                        } else {
                            content = this.extractText(data);
                        }
                    } else {
                        content = this.extractText(data);
                    }

                    // Vérifier si l'URL est déjà indexée et mettre à jour ou insérer le document
                    try {
                        const existingDocument = await this.collection.findOne({ url: currentUrl });
                        if (existingDocument) {
                            await this.collection.updateOne(
                                { url: currentUrl },
                                { $set: { links: Array.from(links), content: content } }
                            );
                            console.log(`Document mis à jour pour ${currentUrl}`);
                        } else {
                            await this.collection.insertOne({
                                url: currentUrl,
                                links: Array.from(links),
                                content: content
                            });
                            console.log(`Document inséré pour ${currentUrl}`);
                        }
                    } catch (error) {
                        console.error(`Échec de l'insertion ou de la mise à jour dans MongoDB pour ${currentUrl}:`, error);
                    }

                    links.forEach(link => {
                        if (!this.visitedUrls.has(link) && !this.failedUrls.has(link)) {
                            this.urlQueue.push(link);
                        }
                    });
                } else {
                    // Si la récupération échoue, ajouter l'URL à l'ensemble des échecs
                    this.failedUrls.add(currentUrl);
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // Être poli et éviter de surcharger le serveur
            }
        }
    }
}

(async () => {
    const baseUrls = [
        "https://coinkivu.com/",
        "https://www.kadea.academy/",
        "https://goma-innovation.com/",
        "https://asrasbl.org/",
    ];
    const crawler = new SimpleWebCrawler(baseUrls);
    await crawler.init();
    await crawler.crawl();
    await crawler.client.close(); // Fermer la connexion MongoDB à la fin
})();
