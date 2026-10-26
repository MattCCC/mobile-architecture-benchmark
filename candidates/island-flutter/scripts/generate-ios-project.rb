#!/usr/bin/env ruby
require 'fileutils'
require 'xcodeproj'

candidate = File.expand_path('..', __dir__)
repo = File.expand_path('../..', candidate)
ios = File.join(candidate, 'ios')
project_path = File.join(ios, 'MBIslandFlutter.xcodeproj')
FileUtils.rm_rf(project_path)

project = Xcodeproj::Project.new(project_path)
target = project.new_target(:application, 'MBIslandFlutter', :ios, '16.4')
target.product_reference.name = 'MBIslandFlutter.app'

core_package = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
core_package.relative_path = '../../_island-host/ios/Core'
project.root_object.package_references << core_package
core_product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
core_product.package = core_package
core_product.product_name = 'MobileBenchCore'
target.package_product_dependencies << core_product
core_build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
core_build_file.product_ref = core_product
target.frameworks_build_phase.files << core_build_file

def add_sources(project, target, group_name, root)
  group = project.main_group.new_group(group_name, root)
  Dir.glob(File.join(root, '**/*.swift')).sort.each do |path|
    target.source_build_phase.add_file_reference(group.new_file(path))
  end
end

shared = File.join(repo, 'candidates/_island-host/ios/App')
add_sources(project, target, 'SharedHost', shared)
add_sources(project, target, 'IslandFlutter', File.join(ios, 'App'))

fixtures = File.join(repo, 'candidates/_island-host/generated/assets/fixtures')
resources = project.main_group.new_group('Fixtures')
fixtures_ref = resources.new_reference(fixtures)
fixtures_ref.last_known_file_type = 'folder'
target.resources_build_phase.add_file_reference(fixtures_ref)

target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.islandflutter',
    'PRODUCT_NAME' => 'MBIslandFlutter',
    'INFOPLIST_FILE' => File.join(shared, 'Info.plist'),
    'SWIFT_VERSION' => '6.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Manual',
    'CODE_SIGN_IDENTITY' => '-',
    'DEVELOPMENT_TEAM' => '',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => '',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'NO',
    'ONLY_ACTIVE_ARCH' => 'NO',
    'ARCHS' => 'arm64',
  )
end

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project_path, 'MBIslandFlutter', true)
puts "generated #{project_path}"
