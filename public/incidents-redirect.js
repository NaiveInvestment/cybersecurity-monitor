const incidentPage = new URL("news.html", location.href);
incidentPage.search = location.search;
incidentPage.searchParams.set("view", "incidents");
incidentPage.hash = location.hash;
location.replace(incidentPage);
