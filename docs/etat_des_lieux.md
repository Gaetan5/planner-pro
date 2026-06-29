# 🔍 État des Lieux — Planner-Pro (Juin 2026)

> **AVERTISSEMENT : RAPPORT SANS FILTRE.**
> Ce document reflète la réalité technique du projet au-delà du vernis marketing.

---

## 📋 Résumé Exécutif

Le projet est techniquement fonctionnel et couvre la roadmap fonctionnelle, mais **il est au bord de la rupture architecturale**. Le rythme effréné de développement a engendré une dette technique qui devient le principal risque pour la viabilité du projet.

## 🏗️ La Réalité Technique (Backend & Données)

* **Prisma : Le Monolithe Dangereux.** Le fichier `schema.prisma` est devenu une usine à gaz ingérable. La logique métier y est trop couplée. Toute modification de schéma est aujourd'hui une opération à haut risque.
* **Pollution du code.** La présence de scripts `test_cli_*.js` en plein milieu du code source est une aberration. Cela confirme l'absence d'une véritable stratégie de test automatisé robuste en CI/CD et l'utilisation dangereuse de tests manuels "à l'arrache".
* **Performance.** Si Redis est présent, il n'est pas encore exploité à sa pleine capacité. La structure actuelle des requêtes MySQL, bien qu'indexée, risque de saturer dès que le volume de données utilisateurs augmentera.

## 🎨 La Réalité Technique (Frontend & Environnement)

* **Configuration Vite : Amateurisme.** La pollution du répertoire `frontend/` par des centaines de fichiers `vite.config.ts.timestamp-*` est un signal d'alerte rouge sur la gestion de l'environnement de développement. C'est "sale", non-professionnel et risque d'impacter les déploiements.
* **Design & Style.** L'interface est fonctionnelle mais manque cruellement de cohérence. Le design est en mode "prototype" alors que le produit est en phase "production".

## 📚 La Réalité Technique (Documentation)

* **Documentation obsolète.** La quantité de fichiers dans `docs/` est inversement proportionnelle à leur utilité actuelle. La plupart sont du bruit et ne sont plus synchronisés avec le code.

---

## 🚀 Plan d'Urgence : Assainissement

1. **Assainir immédiatement** le répertoire `frontend` et corriger la configuration Vite.
2. **Sortir immédiatement** les scripts `test_cli_*.js` de `src/` vers un dossier `tests/` ou `scripts/` dédié, et intégrer une vraie suite de tests.
3. **Refactoriser** le schéma Prisma par domaines fonctionnels.
4. **Élaguer** la documentation : ne garder que l'essentiel et jeter le reste.

**Verdict :** Le projet fonctionne, mais il est mal maintenable en l'état. Le passage à l'échelle immédiat est impossible sans une phase critique de refactoring.
