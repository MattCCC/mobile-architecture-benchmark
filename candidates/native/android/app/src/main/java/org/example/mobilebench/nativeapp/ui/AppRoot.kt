package org.example.mobilebench.nativeapp.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.createGraph
import androidx.navigation.navArgument
import org.example.mobilebench.nativeapp.AppStore

object Routes {
    const val LIST = "list"
    const val SELECTION = "selection"
    const val DETAIL = "detail/{i}"
    const val INSIGHTS = "insights"

    fun detail(i: Int) = "detail/$i"
}

/**
 * Navigation Compose host with the framework's default transitions (design §8.1, §8.7).
 *
 * Restoration (design §8.8): for a restored launch the back stack (e.g. list -> detail/21) is built before the
 * first composition of the NavHost, so the restored screen is the first one drawn and List is not drawn first.
 */
@Composable
fun AppRoot(store: AppStore) {
    val navController = rememberNavController()
    val graph = remember(navController) {
        navController.createGraph(startDestination = Routes.LIST) {
            composable(Routes.LIST) { ListScreen(store, navController) }
            composable(Routes.SELECTION) { SelectionScreen(store, navController) }
            composable(Routes.DETAIL, arguments = listOf(navArgument("i") { type = NavType.IntType })) { entry ->
                DetailScreen(store, entry.arguments?.getInt("i") ?: 0, navController)
            }
            composable(Routes.INSIGHTS) { InsightsScreen(store, navController) }
        }
    }
    val viewModelStoreOwner = checkNotNull(LocalViewModelStoreOwner.current)
    // Runs once per navigation controller, before NavHost composes (it then keeps the same graph and back stack).
    @Suppress("UNUSED_VARIABLE")
    val restoredStackApplied = remember(navController) {
        val restoredStack = store.consumeRestoredStack()
        val apply = restoredStack != null && restoredStack.size > 1 && navController.currentBackStackEntry == null
        if (apply && restoredStack != null) {
            navController.setViewModelStore(viewModelStoreOwner.viewModelStore)
            navController.graph = graph
            restoredStack.drop(1).forEach { navController.navigate(it) }
        }
        apply
    }
    DisposableEffect(navController) {
        var first = true
        // Called at transition start for push and pop (design §6.3 `screen` token nav:<navSeq>). The new top route
        // comes from the listener's own destination and arguments: the back-stack state flows can still hold the
        // previous stack while the listener runs (observed in the emulator smoke run).
        val listener = NavController.OnDestinationChangedListener { _, destination, arguments ->
            val top = when (val pattern = destination.route) {
                null -> Routes.LIST
                Routes.DETAIL -> Routes.detail(arguments?.getInt("i") ?: 0)
                else -> pattern
            }
            // Every secondary screen is reached from List, so the stack is List plus at most one screen.
            store.routeStack = if (top == Routes.LIST) listOf(Routes.LIST) else listOf(Routes.LIST, top)
            store.topRoute = top
            if (first) {
                first = false
            } else {
                store.navSeq = store.navSeq + 1
            }
        }
        navController.addOnDestinationChangedListener(listener)
        onDispose { navController.removeOnDestinationChangedListener(listener) }
    }
    NavHost(
        navController = navController,
        graph = graph,
        modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true },
    )
}

fun NavHostController.navigateOnce(route: String) {
    if (currentDestination?.route == Routes.LIST || route == Routes.LIST) navigate(route)
}
