#!/usr/bin/env ruby
# Turns the Xcode project `ns prepare ios` generates into the shared UIKit island host: adds the host sources
# (candidates/_island-host/ios), its MobileBenchCore package, this candidate's EmbeddingProvider.swift and the
# verified fixtures, and makes the host's Info.plist (scene delegate) the application's. The NativeScript runtime,
# metadata generation and the island bundle stay as the CLI set them up. Idempotent: run after every prepare.
require 'xcodeproj'

candidate = File.expand_path('..', __dir__)
repo = File.expand_path('../..', candidate)
shared = File.join(repo, 'candidates/_island-host/ios')
project_path = File.join(candidate, 'platforms/ios/islandnativescript.xcodeproj')
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == 'islandnativescript' } or abort 'target islandnativescript not found'

unless project.root_object.package_references.any? { |p| p.respond_to?(:relative_path) && p.relative_path.to_s.end_with?('_island-host/ios/Core') }
  core_package = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  core_package.relative_path = '../../../_island-host/ios/Core'
  project.root_object.package_references << core_package
  core_product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  core_product.package = core_package
  core_product.product_name = 'MobileBenchCore'
  target.package_product_dependencies << core_product
  core_build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  core_build_file.product_ref = core_product
  target.frameworks_build_phase.files << core_build_file
end

def add_sources(project, target, group_name, root)
  return if project.main_group.children.any? { |g| g.display_name == group_name }
  group = project.main_group.new_group(group_name, root)
  Dir.glob(File.join(root, '**/*.swift')).sort.each do |path|
    target.source_build_phase.add_file_reference(group.new_file(path))
  end
end

# @nativescript/core's NativeScriptMainWindow.swift implements NativeScript's own window / scene boot, which the
# native host replaces; it is also not Swift 6 concurrency-safe.
target.source_build_phase.files.to_a.each do |build_file|
  next unless build_file.file_ref && build_file.file_ref.path.to_s.end_with?('NativeScriptMainWindow.swift')
  target.source_build_phase.remove_build_file(build_file)
end

add_sources(project, target, 'SharedHost', File.join(shared, 'App'))
add_sources(project, target, 'IslandNativeScript', File.join(candidate, 'ios/App'))

unless project.main_group.children.any? { |g| g.display_name == 'Fixtures' }
  fixtures = File.join(repo, 'candidates/_island-host/generated/assets/fixtures')
  ref = project.main_group.new_group('Fixtures').new_reference(fixtures)
  ref.last_known_file_type = 'folder'
  target.resources_build_phase.add_file_reference(ref)
end

target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.islandnativescript',
    'PRODUCT_NAME' => 'MBIslandNativeScript',
    'INFOPLIST_FILE' => File.join(shared, 'App/Info.plist'),
    'MARKETING_VERSION' => '0.1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'SWIFT_VERSION' => '6.0',
    'SWIFT_OBJC_BRIDGING_HEADER' => File.join(candidate, 'ios/App/IslandNativeScript-Bridging-Header.h'),
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Manual',
    'CODE_SIGN_IDENTITY' => '-',
    'DEVELOPMENT_TEAM' => '',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => '',
    'ONLY_ACTIVE_ARCH' => 'NO',
    'ARCHS' => 'arm64',
  )
  # Appended, not replaced: the metadata generator reads the CLI's paths (@nativescript/core's native helpers).
  paths = Array(config.build_settings['HEADER_SEARCH_PATHS'] || '$(inherited)')
  internal = '"$(SRCROOT)/internal"'
  config.build_settings['HEADER_SEARCH_PATHS'] = paths + [internal] unless paths.include?(internal)
end

project.save
puts "patched #{project_path}"
