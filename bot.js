import axios from "axios";
import cheerio from "cheerio";
import { URL } from "url";
import { MongoClient } from "mongodb";
import mime from "mime-types";
import path from "path";

class SimpleWebCrawler {
  constructor(baseUrls) {
    this.baseUrls = baseUrls;
    this.visitedUrls = new Set();
    this.failedUrls = new Set();
    this.urlQueue = [...baseUrls];

    const uri =
      "mongodb+srv://kalisearch:12RJKw75ElO8dTUd@cluster0.z8zdf0m.mongodb.net/";
    this.client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    this.db = null;
    this.collection = null;
  }

  async init() {
    try {
      await this.client.connect();
      this.db = this.client.db("kali_search");
      this.collection = this.db.collection("web_data");

      await this.collection.insertOne({ test: "Connexion établie" });
      // console.log("Connexion MongoDB établie.");
    } catch (error) {
      console.error("Erreur de connexion à MongoDB:", error);
    }
  }

  async fetchPage(url) {
    try {
      const response = await axios.get(url);
      return {
        data: response.data,
        contentType: response.headers["content-type"],
      };
    } catch (error) {
      console.error(`Échec de la récupération de ${url}:`, error);
      return { data: null, contentType: null };
    }
  }

  parseLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    $("a[href]").each((index, element) => {
      let href = $(element).attr("href");
      if (!href.includes("#")) {
        const fullUrl = new URL(href, baseUrl).href;
        links.add(fullUrl);
      }
    });
    return links;
  }

  containsSignificantJavaScript(html) {
    const $ = cheerio.load(html);
    let containsJavaScript = false;
    $("script").each((index, element) => {
      const scriptContent = $(element).html();
      if (
        scriptContent &&
        /window\.location|document\.cookie|setTimeout|setInterval|fetch|XMLHttpRequest/.test(
          scriptContent
        )
      ) {
        containsJavaScript = true;
        return false;
      }
    });
    return containsJavaScript;
  }

  extractText(html) {
    const $ = cheerio.load(html);
    return $("body").text().trim().replace(/\s+/g, " ");
  }

  async crawl() {
    while (this.urlQueue.length > 0) {
      const currentUrl = this.urlQueue.shift();
      if (
        !this.visitedUrls.has(currentUrl) &&
        !this.failedUrls.has(currentUrl)
      ) {
        // console.log(`Visite de : ${currentUrl}`);
        const { data, contentType } = await this.fetchPage(currentUrl);
        if (data) {
          if (this.containsSignificantJavaScript(data)) {
            // console.log(`Ignoré ${currentUrl} en raison du contenu JavaScript significatif.`);
            continue;
          }

          this.visitedUrls.add(currentUrl);
          const links = this.parseLinks(data, currentUrl);
          let content;

          if (contentType) {
            const mimeType = mime.lookup(currentUrl);
            if (
              mimeType &&
              (mimeType.startsWith("image") || mimeType.startsWith("text"))
            ) {
              const fileName = path.basename(new URL(currentUrl).pathname);
              content = fileName;
            } else {
              content = this.extractText(data);
            }
          } else {
            content = this.extractText(data);
          }

          try {
            const existingDocument = await this.collection.findOne({
              url: currentUrl,
            });
            if (existingDocument) {
              await this.collection.updateOne(
                { url: currentUrl },
                { $set: { links: Array.from(links), content: content } }
              );
              // console.log(`Document mis à jour pour ${currentUrl}`);
            } else {
              await this.collection.insertOne({
                url: currentUrl,
                links: Array.from(links),
                content: content,
              });
              // console.log(`Document inséré pour ${currentUrl}`);
            }
          } catch (error) {
            console.error(
              `Échec de l'insertion ou de la mise à jour dans MongoDB pour ${currentUrl}:`,
              error
            );
          }

          links.forEach((link) => {
            if (!this.visitedUrls.has(link) && !this.failedUrls.has(link)) {
              this.urlQueue.push(link);
            }
          });
        } else {
          this.failedUrls.add(currentUrl);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
    "https://virunga.org",
    "https://www.booking.com",
    "https://www.kwafrikatravel.com",
    "https://www.congotravelandtours.com",
    "https://www.petitfute.com",
    "https://www.tripadvisor.com",
    "https://www.radiookapi.net",
    "https://www.reliefweb.int",
    "https://www.travopo.com",
    "https://www.worldpopulationreview.com",
    "https://www.stay22.com",
    "https://www.openstreetmap.org",
    "https://www.unjobs.org",
    "https://www.geocountry.com",
    "https://www.youtube.com",
    "https://maps.google.com",
    "https://www.facebook.com",
    "https://www.weather.com",
    "https://www.congoforum.be",
    "https://www.catholique.org",
  ];
  const crawler = new SimpleWebCrawler(baseUrls);
  await crawler.init();
  await crawler.crawl();
  await crawler.client.close();
})();
